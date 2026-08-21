-- Fork migration 013: rich README content for shared experiment/resource folders.
--
-- This remains separate from the upstream schema so future upstream migrations
-- can continue using their own version sequence without collisions.
CREATE TABLE IF NOT EXISTS `custom_experiment_folder_readmes` (
  `folder_id` INT UNSIGNED NOT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `content_type` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `updated_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`folder_id`),
  KEY `idx_custom_experiment_folder_readmes_updated_by` (`updated_by`),
  CONSTRAINT `fk_custom_experiment_folder_readmes_folder` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_experiment_folder_readmes_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`userid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
