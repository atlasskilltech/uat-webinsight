-- Atlas Invoice Agent — Gmail integration (multi-account), sync state, and the
-- email/attachment ledger used for dedupe. OAuth tokens are stored ENCRYPTED.

CREATE TABLE IF NOT EXISTS `gmail_integrations` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `google_sub` VARCHAR(191) NULL,                  -- Google account subject id
    `access_token_enc` TEXT NULL,                    -- AES-256-GCM ciphertext
    `refresh_token_enc` TEXT NULL,                   -- AES-256-GCM ciphertext
    `token_expires_at` DATETIME(3) NULL,
    `scopes` TEXT NULL,
    `history_id` VARCHAR(64) NULL,
    `watch_expiration` DATETIME(3) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'connected', -- connected | reauth_required | disconnected | error
    `last_error` TEXT NULL,
    `connected_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `gmail_integrations_org_email_key` (`organization_id`, `email`),
    INDEX `gmail_integrations_status_idx` (`status`),
    CONSTRAINT `gmail_integrations_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gmail_sync_states` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `gmail_integration_id` VARCHAR(191) NOT NULL,
    `last_history_id` VARCHAR(64) NULL,
    `last_full_sync_at` DATETIME(3) NULL,
    `last_incremental_sync_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `consecutive_failures` INT NOT NULL DEFAULT 0,
    `backoff_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `gmail_sync_states_integration_key` (`gmail_integration_id`),
    CONSTRAINT `gmail_sync_states_integration_fk` FOREIGN KEY (`gmail_integration_id`)
        REFERENCES `gmail_integrations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Dedupe ledger: one row per processed Gmail message. The unique key prevents
-- processing the same message twice.
CREATE TABLE IF NOT EXISTS `email_messages` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `gmail_integration_id` VARCHAR(191) NOT NULL,
    `gmail_message_id` VARCHAR(191) NOT NULL,
    `thread_id` VARCHAR(191) NULL,
    `from_address` VARCHAR(320) NULL,
    `to_address` VARCHAR(320) NULL,
    `subject` TEXT NULL,
    `snippet` TEXT NULL,
    `received_at` DATETIME(3) NULL,
    `classification` VARCHAR(32) NULL,               -- supplier_invoice | customer_request | payment_confirmation | ...
    `classification_confidence` DECIMAL(5,2) NULL,
    `is_invoice_candidate` BOOLEAN NOT NULL DEFAULT FALSE,
    `processing_status` VARCHAR(24) NOT NULL DEFAULT 'pending', -- pending | processed | skipped | failed
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `email_messages_message_key` (`gmail_integration_id`, `gmail_message_id`),
    INDEX `email_messages_org_status_idx` (`organization_id`, `processing_status`),
    INDEX `email_messages_received_idx` (`received_at`),
    CONSTRAINT `email_messages_integration_fk` FOREIGN KEY (`gmail_integration_id`)
        REFERENCES `gmail_integrations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `email_message_id` VARCHAR(191) NOT NULL,
    `gmail_attachment_id` VARCHAR(255) NULL,
    `filename` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(128) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `sha256` CHAR(64) NULL,
    `storage_provider` VARCHAR(16) NULL,
    `storage_key` VARCHAR(512) NULL,
    `download_status` VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | downloaded | failed | skipped
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `email_attachments_message_idx` (`email_message_id`),
    UNIQUE INDEX `email_attachments_dedupe_key` (`email_message_id`, `sha256`),
    CONSTRAINT `email_attachments_message_fk` FOREIGN KEY (`email_message_id`)
        REFERENCES `email_messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
