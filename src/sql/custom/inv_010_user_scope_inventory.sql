-- Fork migration inv_010 (database branch only): users.moor_scope_inventory, the scope (1 own entries, 2 team, 3 everything) of the Database list,
-- like users.scope_items is for the resources. Default 2 = team, as upstream's scope_* columns. Without it the team filter of the Database list was
-- skipped (DisplayParams read a column that did not exist) and the entries of every team were listed.
-- moor_ prefix: a column the fork adds to an upstream table (docs/CUSTOM_FORK_MAINTENANCE.md).
-- Guarded: nothing happens when the column is there (a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'moor_scope_inventory');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `users` ADD COLUMN `moor_scope_inventory` TINYINT UNSIGNED NOT NULL DEFAULT 2', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
