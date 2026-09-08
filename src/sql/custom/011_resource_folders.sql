-- Fork migration 011: extend the shared folder tree to resources.
--
-- This remains outside the official eLabFTW schema sequence. The guards make
-- the migration safe on both an existing fork database and a clean install.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'folder_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `items` ADD COLUMN `folder_id` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'folder_id' AND REFERENCED_TABLE_NAME = 'experiments_folders');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `items` ADD CONSTRAINT `fk_custom_items_folder` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
