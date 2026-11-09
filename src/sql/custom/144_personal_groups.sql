-- Fork migration 144: personal user groups. A group with an owner is made by a user for the people he or she gives edit rights to (Database "Who can edit"):
-- only its owner and its members see it. Groups without owner are the groups of the team (made by admins), as before.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'team_groups' AND column_name = 'owner');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `team_groups` ADD COLUMN `owner` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
