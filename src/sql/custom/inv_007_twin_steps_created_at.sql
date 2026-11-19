-- Fork migration inv_007_twin_steps_created_at.sql (database branch only): inventory_steps.created_at mirrors items_steps.created_at (upstream migration steps-created-at). Appended as the last column: this fork never uses AFTER, so fresh and upgraded databases end with the same column order.
-- Guarded: nothing happens when the column is there (an install that has it already, or a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_steps' AND COLUMN_NAME = 'created_at');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory_steps` ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
