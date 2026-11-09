-- Fork migration 104: composite index for the lookups the Order Status tab
-- (OrderProcurements) and the collection sheets (OrderSheets) do for every
-- procurement -- "this team's orders with this procurement ID". The only team
-- index (team, status, created_at) cannot seek on procurement_id, so each of
-- those lookups read every order of the team. The guard makes this safe on
-- rebuilt and upgraded data.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'custom_orders'
        AND INDEX_NAME = 'idx_custom_orders_team_procurement'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders ADD INDEX idx_custom_orders_team_procurement (team, procurement_id)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
