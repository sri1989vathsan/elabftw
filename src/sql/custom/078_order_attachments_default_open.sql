-- Fork migration 078: whether an order's Attachments section starts
-- expanded or collapsed on the board -- admin-only, per team, defaults to
-- open (1) so nothing changes for a team that never touches this setting.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_attachments_default_open');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `orders_attachments_default_open` TINYINT UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
