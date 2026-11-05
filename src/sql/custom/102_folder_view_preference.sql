-- Fork migration 102: the folder view (tree, list or details) a user chose in the Folders side panel, kept per user
-- so it follows them to another browser or computer.
CREATE TABLE IF NOT EXISTS `custom_user_folder_view` (
  `users_id` INT UNSIGNED NOT NULL,
  `view` VARCHAR(16) NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`users_id`),
  CONSTRAINT `fk_custom_user_folder_view_user` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
