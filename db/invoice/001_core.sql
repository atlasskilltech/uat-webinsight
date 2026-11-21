-- Atlas Invoice Agent — core tenant & master-data tables.
-- Dedicated `atlas_invoice` database (separate from atlas_dashboard). Raw MySQL,
-- InnoDB, utf8mb4. Monetary columns are DECIMAL — never FLOAT/DOUBLE.
-- Applied by: npm run invoice:db:init  (idempotent; CREATE TABLE IF NOT EXISTS).
--
-- NOTE on cross-database references: user ids reference atlas_dashboard.`User`.`id`
-- LOGICALLY only. No cross-database FOREIGN KEY is declared (cross-schema FKs are
-- fragile and couple the two databases). Isolation is enforced in the data layer.

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

-- A business party may be a SUPPLIER, a CUSTOMER, or BOTH (see `kind`).
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

-- Catalogue of products/services for outgoing (AR) invoice preparation.
CREATE TABLE IF NOT EXISTS `products_services` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sku` VARCHAR(64) NULL,
    `unit` VARCHAR(32) NULL,
    `default_price` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `default_gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    `hsn_sac` VARCHAR(16) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `products_services_org_idx` (`organization_id`, `is_active`),
    INDEX `products_services_org_sku_idx` (`organization_id`, `sku`),
    CONSTRAINT `products_services_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Per-organization, per-financial-year, per-series invoice number counters.
-- Allocation happens inside a transaction with SELECT ... FOR UPDATE.
CREATE TABLE IF NOT EXISTS `invoice_sequences` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(16) NOT NULL DEFAULT 'outgoing',  -- outgoing | incoming
    `series` VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
    `financial_year` VARCHAR(9) NOT NULL,                 -- e.g. '2026-2027'
    `prefix` VARCHAR(32) NOT NULL DEFAULT 'INV',
    `next_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `padding` TINYINT UNSIGNED NOT NULL DEFAULT 4,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_sequences_key`
        (`organization_id`, `direction`, `series`, `financial_year`),
    CONSTRAINT `invoice_sequences_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
