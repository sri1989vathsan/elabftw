-- Fork migration 073: support multiple auto-archive conditions per team
-- (e.g. "archive after 30 days in Ordered" AND "archive after 14 days in
-- Backlogged" at once), replacing the single orders_autoarchive_status +
-- orders_autoarchive_days pair from 071/072 with a JSON list of
-- {"status": "...", "days": N} rules.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoarchive_rules');
SET @custom_sql = IF(@custom_exists = 0, "ALTER TABLE `teams` ADD COLUMN `orders_autoarchive_rules` JSON NOT NULL DEFAULT (JSON_ARRAY())", 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- Carry over any existing single rule (days = 0 means it was disabled, so
-- nothing to carry for that team -- leave its rules list empty).
SET @custom_had_status = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoarchive_status');
SET @custom_sql = IF(@custom_had_status > 0,
    "UPDATE `teams` SET `orders_autoarchive_rules` = JSON_ARRAY(JSON_OBJECT('status', `orders_autoarchive_status`, 'days', `orders_autoarchive_days`)) WHERE `orders_autoarchive_days` > 0",
    'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_sql = IF(@custom_had_status > 0, 'ALTER TABLE `teams` DROP COLUMN `orders_autoarchive_status`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_had_days = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'orders_autoarchive_days');
SET @custom_sql = IF(@custom_had_days > 0, 'ALTER TABLE `teams` DROP COLUMN `orders_autoarchive_days`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
