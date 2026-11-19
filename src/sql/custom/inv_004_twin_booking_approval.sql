-- Fork migration inv_004_twin_booking_approval.sql (database branch only): inventory.requires_booking_approval mirrors items.requires_booking_approval (upstream migration booking-approvals); same name, type and default because the twin stays parallel to the resource table.
-- Guarded: nothing happens when the column is there (an install that has it already, or a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory' AND COLUMN_NAME = 'requires_booking_approval');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory` ADD COLUMN `requires_booking_approval` TINYINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
