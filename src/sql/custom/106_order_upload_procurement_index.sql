-- Fork migration 106: index on the procurement ID a confirmation upload is tagged
-- with. The Order Status tab (OrderProcurements::basketsOf) looks for the newest
-- upload of a procurement whose text holds "Warenkorb", either tagged with the
-- procurement (this index) or attached to one of its orders (migration 104's
-- index on the orders). Without it the tagged side reads every upload. The guard
-- makes this safe on rebuilt and upgraded data.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'custom_order_uploads'
        AND INDEX_NAME = 'idx_custom_order_uploads_procurement'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_order_uploads ADD INDEX idx_custom_order_uploads_procurement (procurement_id)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
