-- Schema 211
-- Add per-user favorite owner and status filters.
CREATE TABLE `favfilters2users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `filter_type` ENUM('owner', 'status') NOT NULL,
  `target_type` ENUM('all', 'experiments', 'resources') NOT NULL,
  `target_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_favorite_filter` (`users_id`, `filter_type`, `target_type`, `target_id`),
  CONSTRAINT `fk_favfilters2users_users_id`
    FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE config SET conf_value = 211 WHERE conf_name = 'schema';
