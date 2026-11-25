-- Atlas Invoice Agent — per-organisation SENDER FILTERS for forwarding.
--
-- Two independent, per-organisation lists that decide whether a received email
-- is forwarded to the organisation's destination:
--
--   kind='allow'  — the ALLOWED senders. When an organisation has at least one
--                   allowed sender, ONLY mail from those senders is forwarded
--                   ("only the senders I added are received"). With no allowed
--                   senders configured, nothing is forwarded (fail-closed).
--   kind='block'  — EXCLUDED senders (e.g. a specific vendor such as Razorpay).
--                   Mail from an excluded sender is NEVER forwarded, even if the
--                   sender would otherwise be allowed (block always wins).
--
-- A `pattern` is either a full email address ("billing@razorpay.com") or a bare
-- domain ("razorpay.com"), matched case-insensitively; a domain also matches its
-- sub-domains. Everything is scoped by `organization_id` (strict per-org
-- isolation — one org's filters never affect another's).
--
-- BACKWARD COMPATIBILITY: the application reads this table through a
-- missing-table-safe path. Until this migration is applied, forwarding behaves
-- exactly as before (no sender gating). Once the table exists, the allow-list
-- gate takes effect per the rules above.
--
-- This file only CREATES a new table (IF NOT EXISTS) — it never drops or
-- modifies any existing table or data, and is safe to re-run.
CREATE TABLE IF NOT EXISTS `forwarding_sender_filters` (
    `id` VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL, -- 'allow' | 'block'
    `pattern` VARCHAR(320) NOT NULL, -- full email or bare domain, lower-cased
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forwarding_sender_filters_org_kind_pattern_key` (`organization_id`, `kind`, `pattern`),
    INDEX `forwarding_sender_filters_org_idx` (`organization_id`),
    CONSTRAINT `forwarding_sender_filters_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
