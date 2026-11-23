-- Atlas Invoice Agent — duplicate-invoice detection matches.
-- (The legacy AP/AR payments, allocations, approvals, approval-steps, reminders
-- and subscriptions tables were removed with the Finance & Accounts scope reset;
-- no code references them. Only duplicate-match records remain.)

CREATE TABLE IF NOT EXISTS `invoice_duplicate_matches` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `matched_invoice_id` VARCHAR(191) NOT NULL,
    `score` DECIMAL(5,2) NOT NULL DEFAULT 0.00,       -- 0..100
    `reason` JSON NULL,                               -- which signals matched
    `resolution` VARCHAR(16) NOT NULL DEFAULT 'open', -- open | confirmed_duplicate | not_duplicate
    `resolved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_duplicate_matches_pair_key` (`invoice_id`, `matched_invoice_id`),
    INDEX `invoice_duplicate_matches_org_idx` (`organization_id`, `resolution`),
    CONSTRAINT `invoice_duplicate_matches_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
