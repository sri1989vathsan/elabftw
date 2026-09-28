-- Fork migration 072: which status orders_autoarchive_days (see
-- 071_order_autoarchive.sql) watches, instead of always 'ordered'.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoarchive_status');
SET @custom_sql = IF(@custom_exists = 0, "ALTER TABLE `teams` ADD COLUMN `orders_autoarchive_status` VARCHAR(20) NOT NULL DEFAULT 'ordered'", 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
