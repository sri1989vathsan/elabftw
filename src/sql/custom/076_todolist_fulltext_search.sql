-- Fork migration 076: FULLTEXT index backing Todolist::readAll()'s own
-- search over body/notes/description, replacing a leading-wildcard
-- LIKE '%term%' scan (unindexable, full table scan per search) with
-- MATCH() AGAINST() for search terms long enough for MySQL's own default
-- innodb_ft_min_token_size (3) -- readAll() falls back to LIKE only for
-- shorter terms, where a fulltext index can't help anyway.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND INDEX_NAME = 'ft_todolist_search'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist ADD FULLTEXT INDEX ft_todolist_search (body, notes, description)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
