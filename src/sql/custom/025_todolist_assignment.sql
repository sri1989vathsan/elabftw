-- Fork migration 025: assign to-do items to teammates (project management).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'team');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `team` INT UNSIGNED NULL AFTER `userid`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'assigned_userid');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `assigned_userid` INT UNSIGNED NULL AFTER `team`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- backfill: existing tasks are self-assigned, and scoped to the owner's first team
UPDATE `todolist` SET `assigned_userid` = `userid` WHERE `assigned_userid` IS NULL;
UPDATE `todolist` t
    INNER JOIN (SELECT users_id, MIN(teams_id) AS teams_id FROM users2teams GROUP BY users_id) u2t ON u2t.users_id = t.userid
    SET t.team = u2t.teams_id
    WHERE t.team IS NULL;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'team' AND REFERENCED_TABLE_NAME = 'teams');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD CONSTRAINT `fk_custom_todolist_team` FOREIGN KEY (`team`) REFERENCES `teams` (`id`) ON DELETE CASCADE', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'assigned_userid' AND REFERENCED_TABLE_NAME = 'users');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD CONSTRAINT `fk_custom_todolist_assigned_user` FOREIGN KEY (`assigned_userid`) REFERENCES `users` (`userid`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND INDEX_NAME = 'idx_todolist_team_assigned');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD INDEX `idx_todolist_team_assigned` (`team`, `assigned_userid`, `completed_at`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
