-- Fork migration 143: besides the owner, a LabCollector person of the owner map can be matched to the people who may also edit their entries
-- (users and user groups of eLabFTW, as JSON {"users": [ids], "teamgroups": [ids]}).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'registry_owner_map' AND column_name = 'editors');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `registry_owner_map` ADD COLUMN `editors` TEXT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
