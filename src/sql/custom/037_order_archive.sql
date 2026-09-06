-- Fork migration 037: let an order be archived once it's no longer active,
-- so long-lived teams can keep the Requested/Ordered/Received/Cancelled
-- tabs from growing forever without deleting anything.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'archived'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
