-- Fork migration 015: account-wide date and title insertion defaults.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'editor_defaults');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `users` ADD COLUMN `editor_defaults` JSON NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
