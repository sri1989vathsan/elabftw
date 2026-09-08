-- Fork migration 020: per-user template favorites, for the "Insert template"
-- picker's search/mine/favourites filtering.
CREATE TABLE IF NOT EXISTS `custom_template_favorites` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `template_id` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_custom_template_favorites_user_template` (`users_id`, `template_id`),
  KEY `idx_custom_template_favorites_template` (`template_id`),
  CONSTRAINT `fk_custom_template_favorites_user`
    FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_template_favorites_template`
    FOREIGN KEY (`template_id`) REFERENCES `experiments_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
