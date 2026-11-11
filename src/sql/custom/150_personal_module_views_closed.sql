-- Fork migration 150: a look at someone's personal modules (personal_module_views) can be closed by the viewer ("Stop looking").
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'personal_module_views' AND column_name = 'closed_at');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `personal_module_views` ADD COLUMN `closed_at` DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
