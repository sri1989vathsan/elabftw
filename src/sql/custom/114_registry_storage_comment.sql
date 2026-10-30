-- Fork migration 114: a comment on the storage of a registry entry (what is in the tube, who made it, a batch...)
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND COLUMN_NAME = 'comment');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD COLUMN `comment` VARCHAR(255) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
