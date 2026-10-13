-- Fork migration 083: a personal "reference" status for orders, next to the
-- team-wide one (stored as 'reference', shown as "Pinned for all"). A personal
-- reference ('my_reference') behaves the same -- always pinned, status cannot
-- change -- but only its author can see it. See Orders::STATUSES.
SET @custom_needs_my_reference = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE NOT LIKE '%''my_reference''%'
);
SET @custom_sql = IF(@custom_needs_my_reference = 1,
    "ALTER TABLE custom_orders MODIFY COLUMN status ENUM('backlogged', 'requested', 'ordered', 'received', 'cancelled', 'reference', 'my_reference') NOT NULL DEFAULT 'requested'",
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
