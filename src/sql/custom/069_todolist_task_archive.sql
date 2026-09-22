-- Fork migration 069: let an individual task be archived, distinct from
-- completing it -- a done task still clutters the "Done" column/list
-- forever; archiving takes it off every active view (board, sidebar,
-- calendar, counts) without deleting it, same relationship a project's
-- own archived flag (migration 050) has to that project's tasks.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'archived_at'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist ADD COLUMN archived_at DATETIME DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
