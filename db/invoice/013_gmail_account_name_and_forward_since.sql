-- 013: Connected Gmail account display name + forward cutoff.
--
-- display_name: the connected Google account's display name (e.g. "Prasun
--   Pakhira"), captured at connect time via the userinfo `profile` scope. Used
--   in the forwarded-email subject ("You have received an email from <name>");
--   falls back to the account email when absent (older connections).
-- forward_since: the moment the account was (re)connected. Only inbox mail
--   received at/after this is auto-forwarded, so connecting an account never
--   back-forwards old mail. NULL on pre-existing rows (the sync falls back to
--   created_at for those).

ALTER TABLE `gmail_integrations`
    ADD COLUMN IF NOT EXISTS `display_name` VARCHAR(255) NULL AFTER `email`;

ALTER TABLE `gmail_integrations`
    ADD COLUMN IF NOT EXISTS `forward_since` DATETIME NULL AFTER `status`;
