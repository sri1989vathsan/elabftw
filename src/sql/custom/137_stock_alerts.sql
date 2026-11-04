-- Fork migration 137: stock alerts. A container can have an expiry date; an entry can have a minimum stock (a quantity and its unit):
-- the dashboard and the lists warn when the stock of the entry is below it or a container is expired
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND COLUMN_NAME = 'expires_at');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD COLUMN `expires_at` DATE NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory' AND COLUMN_NAME = 'min_stock');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory` ADD COLUMN `min_stock` DECIMAL(12,3) NULL DEFAULT NULL, ADD COLUMN `min_stock_unit` VARCHAR(20) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
