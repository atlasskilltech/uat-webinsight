-- Atlas Invoice Agent — DB-level protection against duplicate organizations.
--
-- A GSTIN identifies one legal entity, so no two organizations may share one.
-- This unique index makes the application-level duplicate guard race-safe: if
-- two Web Insight admins try to create the same GSTIN at nearly the same time,
-- the database rejects the second INSERT (the app turns that into a friendly
-- "already exists" message). MySQL/MariaDB allow MULTIPLE NULLs in a UNIQUE
-- index, so organizations WITHOUT a GSTIN are not blocked.
--
-- Safety: this never drops or edits data. It is added only when (a) the index
-- is absent AND (b) no existing non-NULL GSTIN is already duplicated — so the
-- migration can never fail on pre-existing data. If duplicates already exist
-- (e.g. an accidental duplicate org was created before this shipped), the index
-- is skipped and the application-level guard remains in force until the data is
-- de-duplicated by an administrator (never automatically). Idempotent / safe to
-- re-run on both MySQL 8 and MariaDB.
SET @have_gstin_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema = DATABASE()
    AND table_name = 'organizations'
    AND index_name = 'organizations_gstin_key'
);
SET @dup_gstin := (
  SELECT COUNT(*) FROM (
    SELECT `gstin` FROM `organizations` WHERE `gstin` IS NOT NULL GROUP BY `gstin` HAVING COUNT(*) > 1
  ) d
);
SET @add_gstin_key := IF(
  @have_gstin_key = 0 AND @dup_gstin = 0,
  'ALTER TABLE `organizations` ADD UNIQUE INDEX `organizations_gstin_key` (`gstin`)',
  'SELECT 1'
);
PREPARE _add_gstin_key FROM @add_gstin_key;
EXECUTE _add_gstin_key;
DEALLOCATE PREPARE _add_gstin_key;
