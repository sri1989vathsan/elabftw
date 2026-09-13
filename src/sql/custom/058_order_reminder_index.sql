-- Fork migration 058: keep per-user reminder/calendar lookups fast as the
-- orders table grows. The guard makes this safe on rebuilt and upgraded data.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'custom_orders'
        AND INDEX_NAME = 'idx_custom_orders_user_reminder'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders ADD INDEX idx_custom_orders_user_reminder (userid, reminder_at)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
