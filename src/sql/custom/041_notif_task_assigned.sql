-- Fork migration 041: give "Task assigned" its own real user preference
-- (web/email), matching the other notification categories, instead of
-- always being on with no way to turn it off. Its category number is also
-- moving from 100 into the <20 range so AbstractNotifications::getPref()
-- actually reads the per-user preference for it; existing rows are
-- reassigned to the new category number.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_task_assigned'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_task_assigned TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_task_assigned_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `notifications` SET `category` = 18 WHERE `category` = 100;
