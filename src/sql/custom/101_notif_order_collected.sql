-- Fork migration 101: the notification a person gets when the signed collection sheet for their order arrives
-- ("Orders from Procurement # (...) has been collected"), with its own on/off settings: in the app (on by default)
-- and by email (off by default, like the other order notifications).
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_order_collected'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_order_collected TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_order_collected_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
