-- Atlas Invoice Agent — invoice records detected from email, their line items,
-- stored attachments and AI/OCR extractions. All monetary columns DECIMAL.

CREATE TABLE IF NOT EXISTS `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,                 -- incoming (AP) | outgoing (AR)
    `party_id` VARCHAR(191) NULL,                     -- supplier (incoming) / customer (outgoing)
    `party_name_raw` VARCHAR(191) NULL,               -- as extracted, before party match
    `invoice_number` VARCHAR(128) NULL,
    `po_number` VARCHAR(128) NULL,
    `invoice_date` DATE NULL,
    `due_date` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `payment_terms` VARCHAR(64) NULL,

    -- Deterministic server-computed monetary fields (authoritative). DECIMAL only.
    `subtotal` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `discount_total` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `taxable_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `cgst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `sgst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `igst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `cess` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `tax_total` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `other_charges` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `round_off` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `grand_total` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `amount_paid` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `balance_due` DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    -- Lifecycle. processing_status drives the detection/extraction pipeline.
    `processing_status` VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    `payment_status` VARCHAR(32) NOT NULL DEFAULT 'UNPAID',

    -- Provenance / source of the record.
    `source` VARCHAR(32) NOT NULL DEFAULT 'manual',   -- manual | upload | gmail | api
    `source_email_message_id` VARCHAR(191) NULL,
    `bank_details_enc` TEXT NULL,
    `payment_instructions` TEXT NULL,
    `notes` TEXT NULL,
    `extraction_confidence` DECIMAL(5,2) NULL,
    `document_fingerprint` VARCHAR(64) NULL,          -- sha256 of primary document
    `created_by` VARCHAR(191) NULL,                   -- atlas_dashboard.User.id (logical)
    `issued_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`),
    INDEX `invoices_org_dir_proc_idx` (`organization_id`, `direction`, `processing_status`),
    INDEX `invoices_org_dir_pay_idx` (`organization_id`, `direction`, `payment_status`),
    INDEX `invoices_org_due_idx` (`organization_id`, `due_date`),
    INDEX `invoices_party_idx` (`party_id`),
    INDEX `invoices_fingerprint_idx` (`organization_id`, `document_fingerprint`),
    -- Uniqueness guard for a supplier's invoice number within an org+direction.
    -- NULLs are allowed/duplicable in MySQL, so partially-extracted rows do not collide.
    UNIQUE INDEX `invoices_number_key` (`organization_id`, `direction`, `party_id`, `invoice_number`),
    CONSTRAINT `invoices_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `invoices_party_fk` FOREIGN KEY (`party_id`)
        REFERENCES `invoice_parties` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_line_items` (
    `id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `line_no` INT NOT NULL DEFAULT 1,
    `product_service_id` VARCHAR(191) NULL,           -- optional catalogue reference (no FK)
    `description` TEXT NULL,
    `hsn_sac` VARCHAR(16) NULL,
    `quantity` DECIMAL(15,3) NOT NULL DEFAULT 0.000,
    `unit` VARCHAR(32) NULL,
    `unit_price` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `discount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `taxable_value` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    `cgst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `sgst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `igst` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `cess` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `line_total` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_line_items_invoice_idx` (`invoice_id`),
    INDEX `invoice_line_items_org_idx` (`organization_id`),
    CONSTRAINT `invoice_line_items_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stored documents (downloaded attachments). The bytes live in the storage
-- provider (local/S3); this row holds metadata + storage key only.
CREATE TABLE IF NOT EXISTS `invoice_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NULL,
    `email_attachment_id` VARCHAR(191) NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'primary',    -- primary | support
    `filename` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(128) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `storage_provider` VARCHAR(16) NOT NULL DEFAULT 'local',
    `storage_key` VARCHAR(512) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `scan_status` VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | clean | infected | skipped
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_attachments_invoice_idx` (`invoice_id`),
    INDEX `invoice_attachments_org_idx` (`organization_id`),
    UNIQUE INDEX `invoice_attachments_org_sha_key` (`organization_id`, `sha256`),
    CONSTRAINT `invoice_attachments_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Immutable record of what OCR/AI extracted, with per-field confidence & sources.
CREATE TABLE IF NOT EXISTS `invoice_extractions` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `attachment_id` VARCHAR(191) NULL,
    `ocr_provider` VARCHAR(64) NULL,
    `ai_provider` VARCHAR(64) NULL,
    `ai_model` VARCHAR(128) NULL,
    `raw_text` MEDIUMTEXT NULL,
    `raw_json` JSON NULL,                             -- exactly what the model returned
    `field_confidence` JSON NULL,                     -- { field: 0..1 }
    `field_sources` JSON NULL,                        -- { field: {page,bbox} }
    `overall_confidence` DECIMAL(5,2) NULL,
    `math_check_passed` BOOLEAN NULL,
    `needs_review` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_extractions_invoice_idx` (`invoice_id`),
    INDEX `invoice_extractions_org_idx` (`organization_id`),
    CONSTRAINT `invoice_extractions_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
