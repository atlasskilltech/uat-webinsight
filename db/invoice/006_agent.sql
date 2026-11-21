-- Atlas Invoice Agent — AI agent orchestration persistence: conversations,
-- messages, runs/steps/tool-calls, tasks, memory, approvals, activity, settings.

CREATE TABLE IF NOT EXISTS `agent_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',  -- active | archived
    `last_message_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_conversations_user_idx` (`organization_id`, `user_id`, `last_message_at`),
    CONSTRAINT `agent_conversations_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_messages` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(16) NOT NULL,                      -- user | assistant | tool | system
    `content` MEDIUMTEXT NULL,
    `tool_calls` JSON NULL,
    `run_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_messages_conversation_idx` (`conversation_id`, `created_at`),
    CONSTRAINT `agent_messages_conversation_fk` FOREIGN KEY (`conversation_id`)
        REFERENCES `agent_conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A single orchestrated run (one user instruction → plan → steps → result).
CREATE TABLE IF NOT EXISTS `agent_runs` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `instruction` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'running',  -- running | succeeded | failed | needs_approval | cancelled
    `plan` JSON NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `agent_runs_org_user_idx` (`organization_id`, `user_id`, `started_at`),
    INDEX `agent_runs_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_steps` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_order` INT NOT NULL,
    `kind` VARCHAR(24) NOT NULL,                      -- plan | tool_call | observation | verify | report
    `summary` TEXT NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_steps_run_idx` (`run_id`, `step_order`),
    CONSTRAINT `agent_steps_run_fk` FOREIGN KEY (`run_id`)
        REFERENCES `agent_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_tool_calls` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `tool_name` VARCHAR(96) NOT NULL,
    `arguments` JSON NULL,
    `permission_checked` BOOLEAN NOT NULL DEFAULT FALSE,
    `allowed` BOOLEAN NOT NULL DEFAULT FALSE,
    `requires_approval` BOOLEAN NOT NULL DEFAULT FALSE,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | succeeded | failed | denied | awaiting_approval
    `output` JSON NULL,
    `error` TEXT NULL,
    `duration_ms` INT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_tool_calls_run_idx` (`run_id`),
    INDEX `agent_tool_calls_tool_idx` (`organization_id`, `tool_name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL DEFAULT 'adhoc',      -- adhoc | scheduled
    `schedule_cron` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',   -- active | paused | completed | failed
    `instruction` TEXT NULL,
    `next_run_at` DATETIME(3) NULL,
    `last_run_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_tasks_org_status_idx` (`organization_id`, `status`, `next_run_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_memory` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `scope` VARCHAR(24) NOT NULL DEFAULT 'org',       -- org | user | conversation
    `key_name` VARCHAR(128) NOT NULL,
    `value` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `agent_memory_key` (`organization_id`, `scope`, `user_id`, `key_name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Approval requests raised by the agent for sensitive tool calls.
CREATE TABLE IF NOT EXISTS `agent_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NULL,
    `tool_call_id` VARCHAR(191) NULL,
    `requested_by_user_id` VARCHAR(191) NULL,
    `action` VARCHAR(96) NOT NULL,
    `summary` TEXT NULL,
    `payload` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
    `decided_by_user_id` VARCHAR(191) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_approvals_org_status_idx` (`organization_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_activity_logs` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NULL,
    `user_id` VARCHAR(191) NULL,
    `event` VARCHAR(64) NOT NULL,
    `summary` TEXT NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `agent_activity_logs_org_idx` (`organization_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_settings` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `ai_provider` VARCHAR(32) NULL,
    `ai_model` VARCHAR(128) NULL,
    `autonomy_level` VARCHAR(16) NOT NULL DEFAULT 'assist', -- assist | supervised | auto_read_only
    `auto_send_email` BOOLEAN NOT NULL DEFAULT FALSE,
    `auto_issue_invoice` BOOLEAN NOT NULL DEFAULT FALSE,
    `settings` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `agent_settings_org_key` (`organization_id`),
    CONSTRAINT `agent_settings_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
