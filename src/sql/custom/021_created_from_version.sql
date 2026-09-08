-- Fork migration 021: remember which template version an experiment was
-- created from (or had inserted into it), not just which template.
--
-- created_from_type/created_from_id (upstream columns) only point at the
-- template's current row -- since templates are now versioned and mutable
-- again after each publish, that row's content can drift away from what was
-- actually used. This column freezes the version number at the moment of
-- use.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments' AND COLUMN_NAME = 'created_from_version');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments` ADD COLUMN `created_from_version` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
