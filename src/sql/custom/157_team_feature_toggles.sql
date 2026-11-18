-- Fork migration 157: team switches for features, set by a team admin (Admin panel > Team > Features).
-- tools_compounds and tools_chem_editor: the Compounds and Chemical Structure Editor entries of the Tools menu (ON).
-- tools_opencloning: the OpenCloning entry (OFF; it also needs the server setting USE_OPENCLONING). tools_inventory: the Inventory (storage browser) entry (OFF).
-- feature_bookable_resources: booking of resources (OFF): no "Allow booking" / booking buttons, no new bookings; the bookings and the is_bookable
-- data stay in the database, so switching it on again restores everything.
-- The values are set explicitly for every team, new and existing: this SWITCHES OFF OpenCloning, Inventory and booking for existing teams.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'tools_compounds');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `tools_compounds` TINYINT UNSIGNED NOT NULL DEFAULT 1, ADD COLUMN `tools_chem_editor` TINYINT UNSIGNED NOT NULL DEFAULT 1, ADD COLUMN `tools_opencloning` TINYINT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN `tools_inventory` TINYINT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN `feature_bookable_resources` TINYINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
UPDATE `teams` SET `tools_compounds` = 1, `tools_chem_editor` = 1, `tools_opencloning` = 0, `tools_inventory` = 0, `feature_bookable_resources` = 0 WHERE @custom_exists = 0;
