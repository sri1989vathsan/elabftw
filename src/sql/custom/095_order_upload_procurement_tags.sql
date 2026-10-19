-- Keep each confirmation's identifiers together; never infer attachment
-- provenance by copying the legacy order-level fields.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_uploads' AND COLUMN_NAME = 'procurement_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE custom_order_uploads ADD COLUMN procurement_id VARCHAR(50) NULL, ADD COLUMN order_number VARCHAR(50) NULL, ADD COLUMN order_date DATE NULL', 'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
