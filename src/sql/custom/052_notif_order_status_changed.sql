-- Fork migration 052: give "Order status changed" its own web/email user
-- preference, matching the other notification categories.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_order_status_changed'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_order_status_changed TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_order_status_changed_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
