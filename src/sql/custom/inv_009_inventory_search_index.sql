-- Fork migration inv_009 (database branch only): the full-text index the Database search queries.
-- AbstractEntity's search does MATCH(title, body, elabid), and MySQL only answers a MATCH from a FULLTEXT index with exactly that column list
-- (error 1191 otherwise). inv_005 made idx_items_q four columns (title, body, elabid, metadata_search) like upstream's items table, which is what
-- upstream's own search will want after the merge, so that index stays and a second one with the three columns is added next to it: both
-- queries work, before and after the merge. The metadata_search column stays.
-- Guarded: nothing happens when the index is there (a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory' AND INDEX_NAME = 'idx_moor_inventory_q');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory` ADD FULLTEXT INDEX `idx_moor_inventory_q` (`title`, `body`, `elabid`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
