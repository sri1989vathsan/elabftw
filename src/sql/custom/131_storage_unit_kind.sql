-- Fork migration 131: what a storage place is (a location, a freezer, a fridge, a rack or drawer, a box) and the temperature of a fridge or
-- freezer in degrees Celsius
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'kind');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `kind` VARCHAR(12) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'temperature');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `temperature` SMALLINT NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
