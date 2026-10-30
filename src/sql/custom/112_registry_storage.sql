-- Fork migration 112: storage boxes and primary storage for the registry. A storage unit can be a box of rows x columns slots,
-- a container of a registry entry can sit in a slot (A1 style) and one container per entry is its primary storage.
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

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND COLUMN_NAME = 'position');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD COLUMN `position` VARCHAR(8) NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND COLUMN_NAME = 'is_primary');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD COLUMN `is_primary` TINYINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2inventory' AND INDEX_NAME = 'uq_containers2inventory_slot');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2inventory` ADD UNIQUE KEY `uq_containers2inventory_slot` (`storage_id`, `position`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

UPDATE `containers2inventory` AS c
    JOIN (SELECT item_id, MIN(id) AS first_id FROM `containers2inventory` GROUP BY item_id HAVING SUM(is_primary) = 0) AS f
        ON c.id = f.first_id
    SET c.is_primary = 1;
