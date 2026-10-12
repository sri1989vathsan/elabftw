-- Fork migration 082: default permissions stored on a shared experiment/resource folder.
--
-- A folder can remember who may read and who may edit the items in it. They are applied to the items
-- already in the folder (and its subfolders) when set, and to items added or moved into it later.
-- Kept in a fork-owned table so upstream migrations keep their own numbering.
CREATE TABLE IF NOT EXISTS `custom_experiment_folder_permissions` (
  `folder_id` INT UNSIGNED NOT NULL,
  `canread_base` TINYINT UNSIGNED NOT NULL DEFAULT 30,
  `canwrite_base` TINYINT UNSIGNED NOT NULL DEFAULT 20,
  `canread` JSON NOT NULL,
  `canwrite` JSON NOT NULL,
  `updated_by` INT UNSIGNED NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`folder_id`),
  KEY `idx_custom_experiment_folder_permissions_updated_by` (`updated_by`),
  CONSTRAINT `fk_custom_experiment_folder_permissions_folder` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_experiment_folder_permissions_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`userid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
