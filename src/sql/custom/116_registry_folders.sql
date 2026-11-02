-- Fork migration 116: folders of the database. They are a tree of their own, apart from the folders of the experiments and of the
-- resources, and an entry of the database is in one folder at most (or in none: it is unfiled).
CREATE TABLE IF NOT EXISTS `registry_folders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `parent_id` INT UNSIGNED NULL DEFAULT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `ordering` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_registry_folders_team` (`team`),
  CONSTRAINT `fk_registry_folders_parent` FOREIGN KEY (`parent_id`) REFERENCES `registry_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `registry_folder_entries` (
  `entry_id` INT UNSIGNED NOT NULL,
  `folder_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`entry_id`),
  KEY `idx_registry_folder_entries_folder` (`folder_id`),
  CONSTRAINT `fk_registry_folder_entries_folder` FOREIGN KEY (`folder_id`) REFERENCES `registry_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
