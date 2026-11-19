-- Fork migration inv_008_twin_steps_group_id.sql (database branch only): inventory_steps.group_id and its index mirror items_steps.group_id (upstream schema 228, step groups). No foreign key, like every twin table; the column is NULL (the default group) for every step of the Database.
-- Guarded: nothing happens when the column is there (an install that has it already, or a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_steps' AND COLUMN_NAME = 'group_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory_steps` ADD COLUMN `group_id` INT UNSIGNED NULL DEFAULT NULL, ADD KEY `idx_items_steps_group_id` (`group_id`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
