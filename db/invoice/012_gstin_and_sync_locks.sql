-- Atlas Invoice Agent — GSTIN capture for forwarding validation + per-account
-- Gmail sync locks (strict overlap prevention).
--
-- 1) Persist the extracted BUYER GSTIN on each invoice so the forwarding layer
--    can validate it against the organisation's own GSTIN at send time (GST
--    invoices are only auto-forwarded when the buyer GSTIN matches the org).
--    The application writes this column best-effort and reads it missing-column-
--    safe, so this migration can be applied independently without downtime.
ALTER TABLE `invoices` ADD COLUMN IF NOT EXISTS `buyer_gstin` VARCHAR(20) NULL AFTER `party_name_raw`;

-- 2) Per-account advisory lock so a Gmail account is never synced by two runners
--    at once (in-process scheduler, external cron, Pub/Sub push and manual "Sync
--    now" all funnel through the same claim). Keyed by the integration id; the
--    lock auto-expires (locked_until) so a crashed run cannot wedge an account.
--    Create-only and safe to re-run.
CREATE TABLE IF NOT EXISTS `gmail_sync_locks` (
    `gmail_integration_id` VARCHAR(191) NOT NULL,
    `locked_until` DATETIME(3) NOT NULL,
    PRIMARY KEY (`gmail_integration_id`),
    CONSTRAINT `gmail_sync_locks_integration_fk` FOREIGN KEY (`gmail_integration_id`)
        REFERENCES `gmail_integrations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
