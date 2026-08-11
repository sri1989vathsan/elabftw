-- Fork migration 002: category, owner, and status favorites.
CREATE TABLE IF NOT EXISTS `favcategories2users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `category_type` ENUM('experiments', 'resources') NOT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_favorite_category` (`users_id`, `category_type`, `category_id`),
  CONSTRAINT `fk_custom_favcategories_users` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `favfilters2users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `filter_type` ENUM('owner', 'status') NOT NULL,
  `target_type` ENUM('all', 'experiments', 'resources') NOT NULL,
  `target_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_favorite_filter` (`users_id`, `filter_type`, `target_type`, `target_id`),
  CONSTRAINT `fk_custom_favfilters_users` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
