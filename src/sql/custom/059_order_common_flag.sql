-- Fork migration 059: a "common" flag for orders -- items commonly ordered
-- by the lab (e.g. gloves, tips) as opposed to a one-off request. Unlike
-- the "reference" status (see 047_order_reference_status.sql), this is a
-- plain tag attached at creation time: a common order still goes through
-- the normal requested/ordered/received/cancelled lifecycle and isn't
-- forced to stay pinned -- it's just filterable/labeled as commonly
-- ordered, and can be duplicated to reorder like any other order.
SET @custom_exists_common = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'common'
);
SET @custom_sql = IF(@custom_exists_common = 0,
    'ALTER TABLE custom_orders ADD COLUMN common TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER pinned',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
