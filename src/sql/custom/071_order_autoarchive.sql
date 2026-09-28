-- Fork migration 071: auto-archive an order that's sat in 'ordered' for too
-- long. Off by default (0 days = disabled); admin-only, per team.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoarchive_days');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `orders_autoarchive_days` INT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- When status last changed, so "in ordered for N days" has something to
-- measure from -- defaults to now() for new rows, same as created_at, and
-- is kept in sync by Orders::updateStatus() whenever status actually changes.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'status_changed_at');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `custom_orders` ADD COLUMN `status_changed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- Existing rows just got status_changed_at = now() from the DEFAULT above,
-- which would make every existing 'ordered' order look like it just changed
-- status -- backfill to created_at instead, the closest available signal.
-- This migration file only ever runs once (see CustomMigrationRunner's
-- checksum ledger), so this needs no existence guard of its own.
UPDATE `custom_orders` SET `status_changed_at` = `created_at`;
