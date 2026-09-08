-- Fork migration 037: let each project management board have its own set
-- of Kanban columns, instead of every project in a team sharing one global
-- set. NULL project_id keeps meaning "team default" (used for the
-- Unfiled/All-projects views, and as the template copied into a project's
-- own columns the first time its board is opened).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_columns' AND COLUMN_NAME = 'project_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist_columns` ADD COLUMN `project_id` INT UNSIGNED NULL AFTER `team`, ADD CONSTRAINT `fk_todolist_columns_project` FOREIGN KEY (`project_id`) REFERENCES `todolist_projects` (`id`) ON DELETE CASCADE', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_columns' AND INDEX_NAME = 'idx_todolist_columns_project');
SET @custom_sql = IF(@custom_idx_exists = 0, 'CREATE INDEX `idx_todolist_columns_project` ON `todolist_columns` (`project_id`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
