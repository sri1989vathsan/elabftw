-- Fork migration 147: personal modules. A module with an owner is only seen and used by that user; its entries stay private to them and are never registered in the lab Database (NULL = a module of the lab).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_categories' AND column_name = 'owner');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory_categories` ADD COLUMN `owner` INT UNSIGNED NULL DEFAULT NULL, ADD KEY `inventory_categories_owner` (`owner`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
