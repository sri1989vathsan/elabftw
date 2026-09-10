-- Fork migration 055: an optional reminder date/time on an order. Surfaced
-- to the owner as a VEVENT+VALARM in their existing personal calendar feed
-- (AccountCalendarFeed.php), same as Todolist deadlines already are.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'reminder_at'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders
        ADD COLUMN reminder_at DATETIME NULL DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
