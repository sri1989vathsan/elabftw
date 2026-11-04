-- Fork migration 135: a comment on a place (a freezer, a rack, a box): what is worth knowing about it
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'comment');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `comment` VARCHAR(1000) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
