-- Fork migration 154: the size of the interface a user chose (compact, the default, or comfortable), kept on the user so it follows them to
-- another browser or computer.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'ui_size');
SET @custom_sql = IF(@custom_exists = 0, "ALTER TABLE `users` ADD COLUMN `ui_size` VARCHAR(12) NOT NULL DEFAULT 'compact'", 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
