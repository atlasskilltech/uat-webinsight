-- Atlas Invoice Agent — CC recipients for forwarded invoices, and a stronger
-- duplicate-forward guard keyed on the Gmail message id.
--
-- 1) Deduplicate existing invoice_forwards on
--    (organization_id, source_gmail_message_id, destination) BEFORE adding the
--    unique index. This is only needed because the old code could create more
--    than one forward row for the same Gmail message (the loop bug). The unique
--    index cannot be added while duplicates exist, so the extra rows must go.
--
--    WHICH ROW IS KEPT: for each (org, Gmail message, destination) group we keep
--    exactly ONE row, preferring a 'forwarded' row (so a record of a successful
--    send is never lost), then the earliest created, then the lowest id. Every
--    OTHER row in the group is a redundant duplicate of the same forward.
--
--    SAFE RECOVERY PATH: before removing anything, every row that will be
--    removed is copied verbatim into `invoice_forwards_dedup_archive_008`
--    (same columns + archived_at). Nothing is hard-deleted without a backup, so
--    the operation is fully recoverable. No child table references
--    invoice_forwards (no cascade), and audit_logs reference forwards by a plain
--    string id (no FK), so audit history is NOT deleted and still resolves
--    against the archived row. This never drops or recreates invoice_forwards.
CREATE TABLE IF NOT EXISTS `invoice_forwards_dedup_archive_008` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `gmail_integration_id` VARCHAR(191) NOT NULL,
    `email_message_id` VARCHAR(191) NOT NULL,
    `source_gmail_message_id` VARCHAR(191) NOT NULL,
    `destination` VARCHAR(320) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `confidence` DECIMAL(5,2) NULL,
    `forwarded_message_id` VARCHAR(191) NULL,
    `attempts` INT NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NULL,
    `forwarded_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Copy the duplicate (losing) rows into the archive. INSERT IGNORE keeps this
-- idempotent: on a re-run there are no duplicates left, so nothing is added.
INSERT IGNORE INTO `invoice_forwards_dedup_archive_008`
  (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,
   `destination`,`status`,`confidence`,`forwarded_message_id`,`attempts`,`last_error`,
   `approved_by`,`created_at`,`forwarded_at`)
SELECT `id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,
       `destination`,`status`,`confidence`,`forwarded_message_id`,`attempts`,`last_error`,
       `approved_by`,`created_at`,`forwarded_at`
FROM `invoice_forwards`
WHERE `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `organization_id`, `source_gmail_message_id`, `destination`
        ORDER BY (`status` = 'forwarded') DESC, `created_at` ASC, `id` ASC
      ) AS rn
    FROM `invoice_forwards`
  ) ranked
  WHERE ranked.rn = 1
);

-- Now remove the archived duplicates, keeping the single winner per group.
DELETE FROM `invoice_forwards`
WHERE `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `organization_id`, `source_gmail_message_id`, `destination`
        ORDER BY (`status` = 'forwarded') DESC, `created_at` ASC, `id` ASC
      ) AS rn
    FROM `invoice_forwards`
  ) ranked
  WHERE ranked.rn = 1
);

-- 2) DB-level guarantee: a given Gmail message can be forwarded to a given
--    destination at most once, regardless of rescans, retries, overlapping
--    workers or restarts. (The existing (email_message_id, destination) unique
--    key stays as a secondary guard.)
--    Added only when absent, so this file is itself idempotent / safe to re-run
--    on both MySQL 8 and MariaDB ("ADD UNIQUE INDEX" would otherwise error with
--    "Duplicate key name" on a second run). This only ADDS an index — it never
--    drops or recreates the table or any data.
SET @have_msg_dest_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema = DATABASE()
    AND table_name = 'invoice_forwards'
    AND index_name = 'invoice_forwards_msg_dest_key'
);
SET @add_msg_dest_key := IF(
  @have_msg_dest_key = 0,
  'ALTER TABLE `invoice_forwards` ADD UNIQUE INDEX `invoice_forwards_msg_dest_key` (`organization_id`, `source_gmail_message_id`, `destination`)',
  'SELECT 1'
);
PREPARE _add_idx FROM @add_msg_dest_key;
EXECUTE _add_idx;
DEALLOCATE PREPARE _add_idx;

-- 3) Multiple CC recipients per organization, applied to every forwarded invoice.
CREATE TABLE IF NOT EXISTS `forwarding_cc_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forwarding_cc_org_email_key` (`organization_id`, `email`),
    CONSTRAINT `forwarding_cc_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
