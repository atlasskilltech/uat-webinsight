-- Atlas Invoice Agent — make GSTIN match validation an OPT-IN, per-organisation
-- setting for auto-forwarding.
--
-- Background: the GSTIN auto-forward gate (migration 012) holds a GST invoice
-- for manual review unless its extracted buyer GSTIN matches the organisation's
-- GSTIN. That requires AI extraction to be configured AND the invoice PDF to
-- carry a readable GSTIN. When either is absent the buyer GSTIN is NULL, so the
-- gate silently held EVERY invoice for review and auto-forward appeared broken.
--
-- This column turns the gate into an explicit per-org choice. It defaults to
-- FALSE so auto-forward works out of the box; a Finance Admin enables it only
-- when they want strict buyer-GSTIN enforcement. The application reads it
-- missing-column-safe (FALSE when this migration has not been applied), so the
-- deploy and `invoice:db:init` steps stay independent.
ALTER TABLE `forwarding_settings`
    ADD COLUMN IF NOT EXISTS `gstin_validation` BOOLEAN NOT NULL DEFAULT FALSE AFTER `enabled`;
