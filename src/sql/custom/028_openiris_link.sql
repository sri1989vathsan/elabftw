-- Fork migration 028: per-team editable link to the OpenIRIS booking system.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'openiris_url');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `openiris_url` VARCHAR(255) NULL DEFAULT ''https://reservation-bsse.openiris.io/''', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

UPDATE `teams` SET `openiris_url` = 'https://reservation-bsse.openiris.io/' WHERE `openiris_url` IS NULL;
