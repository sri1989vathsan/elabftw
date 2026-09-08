-- Fork migration 012: allow each user to bookmark multiple folders.
--
-- Keep bookmarks in a fork-owned relation instead of adding another upstream
-- users column. Existing single bookmarks are copied across once.
CREATE TABLE IF NOT EXISTS `custom_favorite_experiment_folders` (
  `users_id` INT UNSIGNED NOT NULL,
  `folder_id` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`users_id`, `folder_id`),
  KEY `idx_custom_favorite_experiment_folders_folder` (`folder_id`),
  CONSTRAINT `fk_custom_favorite_experiment_folders_user` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_favorite_experiment_folders_folder` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO `custom_favorite_experiment_folders` (`users_id`, `folder_id`)
SELECT `userid`, `favorite_experiment_folder`
FROM `users`
WHERE `favorite_experiment_folder` IS NOT NULL;
