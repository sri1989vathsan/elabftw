-- Fork migration inv_001 (database branch only): two team switches for the Database, like the ones of experiments and resources.
-- users_canwrite_inventory: who may create Database entries. users_canwrite_inventory_categories: who may create and edit the modules of the Database.
-- Both are ON for every team, new and existing: any user of the team may create entries and modules; an admin can switch them off (modules are then
-- admin-only again). Admins are always allowed. The permissions of an entry itself (readable by everybody, writable by the owner and admins) do not change.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'users_canwrite_inventory');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `users_canwrite_inventory` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'users_canwrite_inventory_categories');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `users_canwrite_inventory_categories` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
