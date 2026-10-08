-- Fork migration 080: per-team editable link to ETHIS.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'ethis_url');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `ethis_url` VARCHAR(255) NULL DEFAULT ''https://ethis.ethz.ch''', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

UPDATE `teams` SET `ethis_url` = 'https://ethis.ethz.ch' WHERE `ethis_url` IS NULL;
