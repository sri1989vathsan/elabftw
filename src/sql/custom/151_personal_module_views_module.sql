-- Fork migration 151: a look at a personal module is per module (category), not per person: the viewer adds the modules one by one.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'personal_module_views' AND column_name = 'category');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `personal_module_views` ADD COLUMN `category` INT UNSIGNED NULL DEFAULT NULL, ADD KEY `personal_module_views_viewer` (`viewer`, `category`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
-- the looks of before were per person: they no longer give access
UPDATE `personal_module_views` SET closed_at = NOW() WHERE category IS NULL AND closed_at IS NULL;
