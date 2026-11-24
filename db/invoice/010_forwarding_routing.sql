-- Atlas Invoice Agent — Phase 6: configurable forwarding routing.
--
-- Adds reusable document categories, reusable forwarding destinations, and
-- priority-ordered forwarding rules that route an email to a destination based
-- on organization + connected mailbox + sender + document category, with a
-- fallback destination and per-rule automation overrides.
--
-- SAFETY / BACKWARD COMPATIBILITY
--   * This migration is PURELY ADDITIVE. It creates new tables only; it never
--     drops, alters, renames or back-fills any existing table (forwarding_settings,
--     forwarding_cc_recipients, gmail_integrations, invoice_forwards are untouched).
--   * No rules or destinations are seeded for any organization, so the agent's
--     behaviour is UNCHANGED until a Finance Admin opts in: the resolver falls
--     back to the existing single-destination forwarding_settings behaviour
--     whenever an org has no matching enabled rule. Existing auto-forward and
--     review-first safeguards are preserved.
--   * CREATE TABLE IF NOT EXISTS + a guarded unique-index block make the file
--     idempotent and safe to re-run on both MySQL 8 and MariaDB.
--   * Only the 4 SYSTEM document categories (organization_id IS NULL) are seeded;
--     they are shared, read-only defaults, never owned by an org.

-- 1) Document categories. System defaults are org-agnostic (organization_id NULL,
--    is_system = 1). Custom categories belong to one org. The `category_key` is a
--    stable machine key used by rules and by the classifier mapping.
CREATE TABLE IF NOT EXISTS `document_categories` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NULL,              -- NULL => shared system default
    `category_key` VARCHAR(64) NOT NULL,              -- e.g. invoice | purchase_order | statement | other | <custom>
    `label` VARCHAR(120) NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT FALSE,
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    -- One category_key per org; system rows (NULL org) are unique on their own key.
    UNIQUE INDEX `document_categories_org_key` (`organization_id`, `category_key`),
    INDEX `document_categories_org_idx` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the 4 shared system categories (idempotent: a fixed id + INSERT IGNORE).
INSERT IGNORE INTO `document_categories` (`id`,`organization_id`,`category_key`,`label`,`is_system`,`is_active`)
VALUES
  ('sys_cat_invoice',        NULL, 'invoice',        'Invoice',        TRUE, TRUE),
  ('sys_cat_purchaseorder',  NULL, 'purchase_order', 'Purchase Order', TRUE, TRUE),
  ('sys_cat_statement',      NULL, 'statement',      'Statement',      TRUE, TRUE),
  ('sys_cat_other',          NULL, 'other',          'Other',          TRUE, TRUE);

-- 2) Reusable forwarding destinations (a named Finance/AP mailbox etc.). CC
--    recipients specific to this destination are stored as a JSON array of
--    emails; they are merged with the org-wide CC list at send time.
CREATE TABLE IF NOT EXISTS `forwarding_destinations` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `cc_emails` TEXT NULL,                             -- JSON array of CC emails, or NULL
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forwarding_destinations_org_email_key` (`organization_id`, `email`),
    INDEX `forwarding_destinations_org_idx` (`organization_id`),
    CONSTRAINT `forwarding_destinations_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3) Forwarding rules. A rule matches an incoming (ingested) email when every
--    NON-NULL condition matches; NULL conditions mean "any":
--      * match_integration_id  — a specific connected mailbox, or NULL = any
--      * match_sender          — case-insensitive substring of the From header, or NULL = any
--      * match_category_key    — a document category key, or NULL = any
--    Rules are evaluated by `priority` ASC (lower number = higher priority), then
--    oldest first. The first matching ENABLED rule wins. Its `destination_id` is
--    used; if that destination is inactive/removed, `fallback_destination_id` is
--    used. Per-rule `auto_forward` and `min_confidence` override the org defaults
--    (NULL min_confidence => inherit the org/forwarding_settings threshold).
CREATE TABLE IF NOT EXISTS `forwarding_rules` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `priority` INT NOT NULL DEFAULT 100,
    `match_integration_id` VARCHAR(191) NULL,
    `match_sender` VARCHAR(320) NULL,
    `match_category_key` VARCHAR(64) NULL,
    `destination_id` VARCHAR(191) NOT NULL,
    `fallback_destination_id` VARCHAR(191) NULL,
    `auto_forward` BOOLEAN NOT NULL DEFAULT FALSE,
    `min_confidence` DECIMAL(5,2) NULL,               -- NULL => inherit org threshold
    `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `forwarding_rules_org_eval_idx` (`organization_id`, `enabled`, `priority`),
    -- Removing a destination that a rule points to must not silently repoint the
    -- rule: block the delete (RESTRICT) so the admin resolves it explicitly. The
    -- service layer surfaces this as a friendly message.
    CONSTRAINT `forwarding_rules_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `forwarding_rules_dest_fk` FOREIGN KEY (`destination_id`)
        REFERENCES `forwarding_destinations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `forwarding_rules_fallback_fk` FOREIGN KEY (`fallback_destination_id`)
        REFERENCES `forwarding_destinations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
