-- Fork-only order confirmation date; preserve existing orders without a date.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'order_date');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE custom_orders ADD COLUMN order_date DATE NULL AFTER order_number', 'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
