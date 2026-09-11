-- Fork migration 056: let a project be nested under another one (a single
-- level -- a subproject's own parent_id must stay NULL, enforced in
-- TodolistProjects.php, not at the DB level). Self-referencing, no FK
-- constraint (this codebase's custom tables don't use them elsewhere).
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_projects' AND COLUMN_NAME = 'parent_id'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_projects ADD COLUMN parent_id INT UNSIGNED NULL DEFAULT NULL, ADD INDEX (parent_id)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
