-- Fork migration 039: separate web/email notification preferences for
-- @-mentions in comments -- one for to-do/project management tasks, one
-- for orders -- each independent from the other notification categories
-- and from each other.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_mentioned_task'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_mentioned_task TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_mentioned_task_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_mentioned_order TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_mentioned_order_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
