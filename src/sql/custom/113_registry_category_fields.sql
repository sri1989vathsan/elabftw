-- Fork migration 113: fields per registry category. The fields of a category are the custom fields a new entry of it starts with.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_categories' AND COLUMN_NAME = 'fields');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory_categories` ADD COLUMN `fields` JSON NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
