-- Atlas Invoice Agent — core tenant tables.
-- The Invoice Agent's tables live in the database named by ATLAS_INVOICE_DB_NAME
-- (its own dedicated schema, or the main `atlas_dashboard` when configured to
-- share it). Raw MySQL, InnoDB, utf8mb4. Monetary columns are DECIMAL — never
-- FLOAT/DOUBLE. Applied by: npm run invoice:db:init (idempotent; CREATE TABLE IF
-- NOT EXISTS — it only ever creates the Invoice Agent's own tables, never the
-- existing Web Insight tables).
--
-- NOTE on cross-database references: user ids reference atlas_dashboard.`User`.`id`
-- LOGICALLY only. No cross-database FOREIGN KEY is declared (cross-schema FKs are
-- fragile and couple the two databases). Isolation is enforced in the data layer
-- (every query is scoped by organization_id), whether or not the tables share a DB.

CREATE TABLE IF NOT EXISTS `organizations` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `legal_name` VARCHAR(191) NULL,
    `gstin` VARCHAR(20) NULL,
    `pan` VARCHAR(16) NULL,
    `base_currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `address` JSON NULL,
    `settings` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `organizations_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Links an atlas_dashboard User to an organization with a finance role.
CREATE TABLE IF NOT EXISTS `organization_members` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,        -- references atlas_dashboard.User.id (logical)
    `user_email` VARCHAR(191) NOT NULL,
    `role` VARCHAR(32) NOT NULL DEFAULT 'FINANCE_VIEWER',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `organization_members_org_user_key` (`organization_id`, `user_id`),
    INDEX `organization_members_user_idx` (`user_id`),
    INDEX `organization_members_email_idx` (`user_email`),
    CONSTRAINT `organization_members_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The supplier/vendor a detected invoice is matched to (by GSTIN/name) during
-- processing. Kept because invoices.party_id references it and the processing
-- pipeline looks parties up for duplicate detection.
CREATE TABLE IF NOT EXISTS `invoice_parties` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'supplier',   -- supplier | customer | both
    `business_name` VARCHAR(191) NOT NULL,
    `legal_name` VARCHAR(191) NULL,
    `gstin` VARCHAR(20) NULL,
    `pan` VARCHAR(16) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(64) NULL,
    `contact_person` VARCHAR(191) NULL,
    `billing_address` JSON NULL,
    `shipping_address` JSON NULL,
    `payment_terms` VARCHAR(64) NULL,
    `default_currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `bank_details_enc` TEXT NULL,            -- AES-256-GCM ciphertext (never plaintext)
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `invoice_parties_org_kind_idx` (`organization_id`, `kind`),
    INDEX `invoice_parties_org_gstin_idx` (`organization_id`, `gstin`),
    INDEX `invoice_parties_org_name_idx` (`organization_id`, `business_name`),
    CONSTRAINT `invoice_parties_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
