-- Fork migration 054: link an order to the LabCollector record it's for
-- (item type + numeric id, same module/id scheme as the existing
-- LabCollector link already insertable into an entity's body -- see
-- buildLabCollectorUrl() in src/ts/labcollector-link.ts). Both columns are
-- set together or not at all, enforced in Orders.php, not at the DB level.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'labcollector_type'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders
        ADD COLUMN labcollector_type VARCHAR(32) NULL DEFAULT NULL,
        ADD COLUMN labcollector_id VARCHAR(16) NULL DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
