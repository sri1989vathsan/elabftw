-- Fork migration 146: the order of the columns a user chose by dragging the headers of the tables of the database (list of column keys, for each user and module).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'registry_column_prefs' AND column_name = 'col_order');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `registry_column_prefs` ADD COLUMN `col_order` JSON NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
