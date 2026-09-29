-- Fork migration 075: "last updated" tracking for the board's own task
-- cards (who touched a task, and when) -- set by Todolist::update()/
-- touchUpdated() on every meaningful field change, deliberately excluding
-- pure drag-reordering (see update()'s own comment).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'updated_at');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'updated_by');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `updated_by` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
