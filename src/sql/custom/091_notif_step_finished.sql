-- Fork migration 091: its own web/email preference for "a step was completed"
-- (sent to everyone who can edit the entry).
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notif_step_finished'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE users
        ADD COLUMN notif_step_finished TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
        ADD COLUMN notif_step_finished_email TINYINT(1) UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
