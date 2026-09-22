-- Fork migration 070: composite index for the archived-task filter every
-- default todolist query now carries (see Todolist::readAll()'s own
-- archivedClause) -- without it, filtering thousands of tasks down to
-- "not archived" (or the dedicated "only archived" list) means scanning
-- every row for this team instead of seeking straight to the ones that
-- match.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND INDEX_NAME = 'idx_todolist_team_archived'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist ADD INDEX idx_todolist_team_archived (team, archived_at)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
