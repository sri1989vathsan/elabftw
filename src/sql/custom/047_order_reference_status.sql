-- Fork migration 047: add a "reference" status for orders that are shared
-- team references (recurring supplies, standing links, etc.) rather than
-- an actual request moving through the requested/ordered/received/cancelled
-- workflow -- see Orders::STATUSES. A reference order is exempt from the
-- "Mine" owner filter (always visible to the whole team) and, unlike a
-- pinned order in one of the other statuses, does not also appear on the
-- other status tabs -- it only shows on its own Reference tab (and All).
SET @custom_needs_reference = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE NOT LIKE '%''reference''%'
);
SET @custom_sql = IF(@custom_needs_reference = 1,
    "ALTER TABLE custom_orders MODIFY COLUMN status ENUM('requested', 'ordered', 'received', 'cancelled', 'reference') NOT NULL DEFAULT 'requested'",
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
