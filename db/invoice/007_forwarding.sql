-- Atlas Invoice Agent — forwarding configuration and forward log.
-- Review-first: emails are queued; they forward only when an account has
-- auto_forward enabled (and confidence >= threshold) or a human approves.

CREATE TABLE IF NOT EXISTS `forwarding_settings` (
    `organization_id` VARCHAR(191) NOT NULL,
    `finance_destination` VARCHAR(320) NULL,
    `min_confidence` DECIMAL(5,2) NOT NULL DEFAULT 70.00,  -- percent (0-100)
    `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`organization_id`),
    CONSTRAINT `forwarding_settings_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Per-account automation switch (review-first by default).
ALTER TABLE `gmail_integrations` ADD COLUMN IF NOT EXISTS `auto_forward` BOOLEAN NOT NULL DEFAULT FALSE AFTER `status`;

-- One forward task per detected invoice email. The unique key makes forwarding
-- idempotent so retries / re-syncs never forward the same email twice.
CREATE TABLE IF NOT EXISTS `invoice_forwards` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `gmail_integration_id` VARCHAR(191) NOT NULL,
    `email_message_id` VARCHAR(191) NOT NULL,
    `source_gmail_message_id` VARCHAR(191) NOT NULL,
    `destination` VARCHAR(320) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',   -- pending | approved | forwarded | failed | skipped | review
    `confidence` DECIMAL(5,2) NULL,
    `forwarded_message_id` VARCHAR(191) NULL,
    `attempts` INT NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `forwarded_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_forwards_dedupe_key` (`email_message_id`, `destination`),
    INDEX `invoice_forwards_org_status_idx` (`organization_id`, `status`),
    INDEX `invoice_forwards_account_idx` (`gmail_integration_id`),
    CONSTRAINT `invoice_forwards_email_fk` FOREIGN KEY (`email_message_id`)
        REFERENCES `email_messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
