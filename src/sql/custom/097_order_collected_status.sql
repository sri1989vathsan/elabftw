-- Fork migration 097: a "collected" status for orders whose goods have been picked up from the shop (set
-- automatically when the signed shop sheet for their procurement is dropped on the orders page). A plain status like
-- requested/ordered/received. See Orders::STATUSES.
SET @custom_needs_collected = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE NOT LIKE '%''collected''%'
);
SET @custom_sql = IF(@custom_needs_collected = 1,
    "ALTER TABLE custom_orders MODIFY COLUMN status ENUM('backlogged', 'requested', 'ordered', 'received', 'collected', 'cancelled', 'reference', 'my_reference', 'pinned_all') NOT NULL DEFAULT 'requested'",
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
