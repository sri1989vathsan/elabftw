-- Fork migration inv_006_twin_category_color_fg.sql (database branch only): inventory_categories.color_fg mirrors items_categories.color_fg (upstream schema 220 and following): the text colour of a category.
-- Guarded: nothing happens when the column is there (an install that has it already, or a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_categories' AND COLUMN_NAME = 'color_fg');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory_categories` ADD COLUMN `color_fg` CHAR(6) NOT NULL DEFAULT ''ffffff''', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
