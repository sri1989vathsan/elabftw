-- Schema 210
-- Add per-user favorite experiment and resource categories.
CREATE TABLE `favcategories2users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `category_type` ENUM('experiments', 'resources') NOT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_favorite_category` (`users_id`, `category_type`, `category_id`),
  CONSTRAINT `fk_favcategories2users_users_id`
    FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE config SET conf_value = 210 WHERE conf_name = 'schema';
