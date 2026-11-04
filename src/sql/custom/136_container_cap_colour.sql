-- Fork migration 136: the colour of the cap of a container (a hex colour such as #1677ff), on the links of entries and of items alike
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND COLUMN_NAME = 'cap_colour');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD COLUMN `cap_colour` VARCHAR(9) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2items' AND COLUMN_NAME = 'cap_colour');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2items` ADD COLUMN `cap_colour` VARCHAR(9) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
