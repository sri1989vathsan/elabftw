-- Fork migration 053: add a "backlogged" status for orders that are known
-- to be needed but not yet actually requested -- a plain status like
-- requested/ordered/received/cancelled (its own tab, counted/filtered the
-- same way), unlike "reference" which has its own bespoke visibility
-- rules. See Orders::STATUSES.
SET @custom_needs_backlogged = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE NOT LIKE '%''backlogged''%'
);
SET @custom_sql = IF(@custom_needs_backlogged = 1,
    "ALTER TABLE custom_orders MODIFY COLUMN status ENUM('backlogged', 'requested', 'ordered', 'received', 'cancelled', 'reference') NOT NULL DEFAULT 'requested'",
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
