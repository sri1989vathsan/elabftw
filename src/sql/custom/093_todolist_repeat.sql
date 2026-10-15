-- Fork migration 093: repeating to-dos. repeat_rule holds the rule as JSON
-- ({"unit":"week","every":2,"until":"2026-12-31","count":null}); when the task
-- is completed the next one is created and repeat_spawned_id points to it, so
-- completing, reopening and completing again never makes a second copy.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'repeat_rule'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist ADD COLUMN repeat_rule VARCHAR(255) NULL, ADD COLUMN repeat_spawned_id INT UNSIGNED NULL',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
