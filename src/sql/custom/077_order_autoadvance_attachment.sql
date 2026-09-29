-- Fork migration 077: optionally auto-advance an order from 'requested' to
-- 'ordered' as soon as ANY file is attached (as opposed to
-- orders_autoadvance_on_procurement_id, which only fires once a
-- procurement ID is actually extracted from one). Off by default,
-- admin-only, per team.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoadvance_on_attachment');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `orders_autoadvance_on_attachment` TINYINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
