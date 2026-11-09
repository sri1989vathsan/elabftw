-- Fork migration 107: index for the Orders board's list. Every page of it is
-- "this team's orders that are (not) archived and (not) pinned, newest first,
-- LIMIT n" (Orders::readAll). The existing team index (team, status,
-- created_at) cannot serve that order, so MySQL read every order of the team
-- and sorted them to return one page: with 60,000 orders in a local benchmark
-- the pinned/unpinned page query took about 640 ms. With this index it walks
-- the newest end of the index and stops after one page (about 3 ms, EXPLAIN:
-- index range scan, no sort). The guard makes this safe on rebuilt and
-- upgraded data.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'custom_orders'
        AND INDEX_NAME = 'idx_custom_orders_team_list'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders ADD INDEX idx_custom_orders_team_list (team, archived, pinned, created_at)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
