-- Fork migration 038: richer project details (a rich-text goals/description
-- field instead of a 500-char plain string, a target end date, a
-- planning/active/on_hold/done status), plus the ability to pin a task so
-- it stays at the top of its column regardless of sort order.
ALTER TABLE todolist_projects
    MODIFY COLUMN description MEDIUMTEXT NULL;

SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_projects' AND COLUMN_NAME = 'target_end_date'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_projects ADD COLUMN target_end_date DATE NULL AFTER description',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_projects' AND COLUMN_NAME = 'status'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_projects ADD COLUMN status ENUM(\'planning\', \'active\', \'on_hold\', \'done\') NOT NULL DEFAULT \'planning\' AFTER target_end_date',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'pinned'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist ADD COLUMN pinned TINYINT(1) UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
