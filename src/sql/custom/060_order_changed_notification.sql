-- Fork migration 060: a general "your order was changed" notification --
-- content edits, a file attached, or a comment left by someone else on
-- your order (status changes already have their own notification, see
-- 052_notif_order_status_changed.sql). Also flips the email default to off
-- for the order-related notifications, so people aren't opted into email
-- for these until they explicitly turn it on -- the in-app/web notification
-- still defaults on.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_order_changed'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_order_changed TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_order_changed_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE users MODIFY COLUMN notif_mentioned_order_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE users MODIFY COLUMN notif_order_status_changed_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 0;
UPDATE users SET notif_mentioned_order_email = 0, notif_order_status_changed_email = 0;
