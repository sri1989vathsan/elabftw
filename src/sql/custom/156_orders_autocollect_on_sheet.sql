-- Fork migration 156: a team admin can switch off the automatic move of an order from Ordered to Collected when a shop sheet PDF is matched to it.
-- It is ON by default, for every team (new and existing): this is what the orders board does today (OrderSheets::markCollected), so the
-- column is added with the value 1 and nothing changes until an admin turns it off.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autocollect_on_sheet');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `orders_autocollect_on_sheet` TINYINT UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
