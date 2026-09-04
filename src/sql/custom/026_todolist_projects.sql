-- Fork migration 026: project boards for the assignable to-do list.
CREATE TABLE IF NOT EXISTS `todolist_projects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `userid` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_custom_todolist_projects_team` FOREIGN KEY (`team`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_todolist_projects_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `todolist_project_members` (
  `project_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`project_id`, `userid`),
  CONSTRAINT `fk_custom_tpm_project` FOREIGN KEY (`project_id`) REFERENCES `todolist_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_tpm_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'project_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `project_id` INT UNSIGNED NULL AFTER `assigned_userid`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'project_id' AND REFERENCED_TABLE_NAME = 'todolist_projects');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD CONSTRAINT `fk_custom_todolist_project` FOREIGN KEY (`project_id`) REFERENCES `todolist_projects` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND INDEX_NAME = 'idx_todolist_project');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD INDEX `idx_todolist_project` (`project_id`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
