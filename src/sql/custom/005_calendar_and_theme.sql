-- Fork migration 005: account calendar feeds and palette selection.
CREATE TABLE IF NOT EXISTS `calendar_feed_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `users_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_calendar_feed_user` (`users_id`),
  UNIQUE KEY `unique_calendar_feed_token_hash` (`token_hash`),
  CONSTRAINT `fk_custom_calendar_feed_user` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'theme_palette');
SET @custom_sql = IF(@custom_exists = 0, "ALTER TABLE `users` ADD COLUMN `theme_palette` VARCHAR(16) NOT NULL DEFAULT 'classic' AFTER `theme_variant`", 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
