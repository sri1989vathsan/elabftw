-- Fork migration 139: personal storage. A place with an owner is the storage of that person only (a drawer, a freezer shelf, a box of their own);
-- a place without owner is the storage of the lab, visible to everyone. The places inside a place have the owner of their parent.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'owner_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `owner_id` INT UNSIGNED NULL DEFAULT NULL, ADD KEY `storage_units_owner_id` (`owner_id`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
