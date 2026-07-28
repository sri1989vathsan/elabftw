-- Schema 214
-- Add per-account external calendar subscriptions and page colour palettes.
CREATE TABLE `calendar_feed_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_calendar_feed_user` (`users_id`),
  UNIQUE KEY `unique_calendar_feed_token_hash` (`token_hash`),
  CONSTRAINT `fk_calendar_feed_tokens_users_id`
    FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `users`
  ADD COLUMN `theme_palette` VARCHAR(16) NOT NULL DEFAULT 'classic' AFTER `theme_variant`;

UPDATE config SET conf_value = 214 WHERE conf_name = 'schema';
