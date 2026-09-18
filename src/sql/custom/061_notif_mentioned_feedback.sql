-- Fork migration 061: give "Mentioned in a feedback comment" its own
-- web/email user preference, matching notif_mentioned_task/notif_mentioned_order.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_mentioned_feedback'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_mentioned_feedback TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_mentioned_feedback_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
