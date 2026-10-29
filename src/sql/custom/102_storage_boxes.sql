-- Fork migration 102: storage boxes. A storage unit can be a box of rows x columns slots, and a container of a
-- resource can sit in a slot of its box (A1 style), so the box can be drawn as a grid.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'box_rows');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `box_rows` TINYINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'box_cols');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `box_cols` TINYINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2items' AND COLUMN_NAME = 'position');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2items` ADD COLUMN `position` VARCHAR(8) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- one container per slot of a box (several rows without a slot are fine: NULLs do not collide)
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2items' AND INDEX_NAME = 'uq_containers2items_slot');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2items` ADD UNIQUE KEY `uq_containers2items_slot` (`storage_id`, `position`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
