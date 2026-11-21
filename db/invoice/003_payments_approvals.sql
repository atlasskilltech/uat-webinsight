-- Atlas Invoice Agent — payments, allocations, approvals, reminders,
-- subscriptions and duplicate matches.

CREATE TABLE IF NOT EXISTS `invoice_payments` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,                 -- incoming (we pay) | outgoing (we receive)
    `amount` DECIMAL(15,2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `paid_on` DATE NOT NULL,
    `method` VARCHAR(32) NULL,                        -- neft | upi | cheque | cash | card | other
    `txn_reference` VARCHAR(191) NULL,
    `bank_reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `recorded_by` VARCHAR(191) NULL,                 -- human who recorded it (never the LLM alone)
    `source` VARCHAR(32) NOT NULL DEFAULT 'manual',  -- manual | reconciliation
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_payments_org_dir_idx` (`organization_id`, `direction`, `paid_on`),
    CONSTRAINT `invoice_payments_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A payment can be allocated across one or more invoices (and an invoice can be
-- covered by several payments). Allocation is transactional with FOR UPDATE.
CREATE TABLE IF NOT EXISTS `invoice_payment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15,2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_payment_allocations_pair_key` (`payment_id`, `invoice_id`),
    INDEX `invoice_payment_allocations_invoice_idx` (`invoice_id`),
    CONSTRAINT `invoice_payment_allocations_payment_fk` FOREIGN KEY (`payment_id`)
        REFERENCES `invoice_payments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `invoice_payment_allocations_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One approval workflow instance per invoice version. Bound to the exact amount
-- approved; a material change restarts it (enforced in the service layer).
CREATE TABLE IF NOT EXISTS `invoice_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
    `current_step` INT NOT NULL DEFAULT 1,
    `approved_amount` DECIMAL(15,2) NULL,             -- the amount this workflow is bound to
    `invoice_version` INT NOT NULL DEFAULT 1,
    `policy_snapshot` JSON NULL,                      -- the policy in force when it started
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `invoice_approvals_invoice_idx` (`invoice_id`),
    INDEX `invoice_approvals_org_status_idx` (`organization_id`, `status`),
    CONSTRAINT `invoice_approvals_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_approval_steps` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `approval_id` VARCHAR(191) NOT NULL,
    `step_order` INT NOT NULL,
    `approver_role` VARCHAR(32) NULL,
    `approver_user_id` VARCHAR(191) NULL,
    `assigned_to_user_id` VARCHAR(191) NULL,
    `decision` VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | approved | rejected | reassigned
    `reason` TEXT NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_approval_steps_approval_idx` (`approval_id`, `step_order`),
    CONSTRAINT `invoice_approval_steps_approval_fk` FOREIGN KEY (`approval_id`)
        REFERENCES `invoice_approvals` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_reminders` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,                      -- t_minus_7 | t_minus_3 | t_minus_1 | overdue
    `scheduled_for` DATE NOT NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'inapp',   -- inapp | email
    `status` VARCHAR(16) NOT NULL DEFAULT 'scheduled',-- scheduled | sent | cancelled | skipped
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `invoice_reminders_dedupe_key` (`invoice_id`, `kind`, `channel`),
    INDEX `invoice_reminders_due_idx` (`scheduled_for`, `status`),
    CONSTRAINT `invoice_reminders_invoice_fk` FOREIGN KEY (`invoice_id`)
        REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(16) NOT NULL DEFAULT 'outgoing',
    `party_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `frequency` VARCHAR(16) NOT NULL DEFAULT 'monthly', -- weekly | monthly | quarterly | yearly
    `recurring_items` JSON NULL,
    `tax_config` JSON NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `next_run_date` DATE NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',   -- active | paused | cancelled
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `invoice_subscriptions_org_next_idx` (`organization_id`, `next_run_date`, `status`),
    CONSTRAINT `invoice_subscriptions_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
