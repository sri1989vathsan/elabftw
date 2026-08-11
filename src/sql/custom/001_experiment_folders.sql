-- Fork migration 001: hierarchical experiment folders.
CREATE TABLE IF NOT EXISTS `experiments_folders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `parent_id` INT UNSIGNED NULL DEFAULT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `ordering` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_custom_experiments_folders_parent` FOREIGN KEY (`parent_id`) REFERENCES `experiments_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_experiments_folders_team` FOREIGN KEY (`team`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_experiments_folders_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments' AND COLUMN_NAME = 'folder_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments` ADD COLUMN `folder_id` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments' AND COLUMN_NAME = 'folder_id' AND REFERENCED_TABLE_NAME = 'experiments_folders');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments` ADD CONSTRAINT `fk_custom_experiments_folder` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'favorite_experiment_folder');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `users` ADD COLUMN `favorite_experiment_folder` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'favorite_experiment_folder' AND REFERENCED_TABLE_NAME = 'experiments_folders');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `users` ADD CONSTRAINT `fk_custom_users_favorite_experiment_folder` FOREIGN KEY (`favorite_experiment_folder`) REFERENCES `experiments_folders` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
