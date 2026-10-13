-- Fork migration 084: swap the meaning of the two pinned order statuses. The old
-- team-wide 'reference' status becomes the personal 'my_reference' (shown as
-- "Reference", visible only to its author), and a new team-wide 'pinned_all'
-- (shown as "Pinned for all") starts out empty. 'reference' stays in the ENUM
-- only so an older checkout still reads the column; nothing uses it any more.
SET @custom_needs_pinned_all = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE NOT LIKE '%''pinned_all''%'
);
SET @custom_sql = IF(@custom_needs_pinned_all = 1,
    "ALTER TABLE custom_orders MODIFY COLUMN status ENUM('backlogged', 'requested', 'ordered', 'received', 'cancelled', 'reference', 'my_reference', 'pinned_all') NOT NULL DEFAULT 'requested'",
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE custom_orders SET status = 'my_reference' WHERE status = 'reference';
