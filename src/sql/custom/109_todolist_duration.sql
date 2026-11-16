-- Fork migration 109: how long a to-do task takes, in minutes (the deadline is when it starts).
-- Every task has one: 30 minutes by default, which is what the calendar feed always used. It is
-- changed per task in the task editor and is what the calendar events (feed, Google Calendar) last.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'duration_minutes');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `duration_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER `reminder_minutes`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
