-- Atlas Invoice Agent — DB-backed job queue, audit trail, and notifications.

-- DB-backed queue. Workers claim jobs with SELECT ... FOR UPDATE SKIP LOCKED.
CREATE TABLE IF NOT EXISTS `processing_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NULL,
    `type` VARCHAR(64) NOT NULL,                      -- gmail_sync | download_attachment | ocr | ai_extract | validate | dedupe | reminder | recurring | report | agent_task | ...
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',  -- queued | running | succeeded | failed | dead
    `priority` INT NOT NULL DEFAULT 100,
    `payload` JSON NULL,
    `result` JSON NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `attempts` INT NOT NULL DEFAULT 0,
    `max_attempts` INT NOT NULL DEFAULT 5,
    `last_error` TEXT NULL,
    `run_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `locked_by` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `processing_jobs_claim_idx` (`status`, `run_after`, `priority`),
    INDEX `processing_jobs_org_type_idx` (`organization_id`, `type`, `status`),
    UNIQUE INDEX `processing_jobs_idempotency_key` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Immutable audit trail for every financial / sensitive mutation (before/after).
CREATE TABLE IF NOT EXISTS `invoice_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NULL,
    `actor_type` VARCHAR(16) NOT NULL DEFAULT 'user', -- user | agent | system
    `actor_user_id` VARCHAR(191) NULL,
    `actor_label` VARCHAR(191) NULL,
    `action` VARCHAR(96) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_audit_logs_entity_idx` (`organization_id`, `entity_type`, `entity_id`),
    INDEX `invoice_audit_logs_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,                 -- atlas_dashboard.User.id (logical)
    `type` VARCHAR(48) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(512) NULL,
    `payload` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `notifications_user_idx` (`user_id`, `read_at`),
    INDEX `notifications_org_idx` (`organization_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `email_enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `inapp_enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `rules` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `notification_preferences_org_user_key` (`organization_id`, `user_id`),
    CONSTRAINT `notification_preferences_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
