-- Fork migration 048: store the "Beschaffungs-ID" (procurement id) and
-- "Bestellung Nr." (purchase order number) auto-extracted from an
-- uploaded order-confirmation PDF, so they can be shown as tags on the
-- order and matched by search -- see OrderUploads::extractOne().
SET @custom_exists_procurement_id = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'procurement_id'
);
SET @custom_sql = IF(@custom_exists_procurement_id = 0,
    'ALTER TABLE custom_orders ADD COLUMN procurement_id VARCHAR(50) NULL AFTER notes',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_exists_order_number = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'order_number'
);
SET @custom_sql = IF(@custom_exists_order_number = 0,
    'ALTER TABLE custom_orders ADD COLUMN order_number VARCHAR(50) NULL AFTER procurement_id',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
