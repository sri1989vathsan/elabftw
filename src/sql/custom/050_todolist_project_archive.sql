-- Fork migration 050: let a project be archived instead of deleted --
-- see TodolistProjects.php. Its tasks are unaffected either way (their
-- own project_id FK already SET NULLs on a real delete; archiving
-- doesn't touch them at all).
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_projects' AND COLUMN_NAME = 'archived'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_projects ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
