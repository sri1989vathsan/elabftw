-- Fork migration 092: remember who assigned a step (put the @mention in its
-- text), so that person is told when the assignee completes it.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_step_mentions' AND COLUMN_NAME = 'assigner_userid'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_step_mentions ADD COLUMN assigner_userid INT UNSIGNED NULL AFTER userid',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
