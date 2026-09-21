-- Fork migration 063: team-scoped announcements. A team admin publishes an
-- announcement (title/body/severity, optional expiry) that shows as a
-- dashboard banner to every team member until it expires (or forever, if
-- no expiry is set); every member also gets a regular notification for it.
CREATE TABLE IF NOT EXISTS `custom_announcements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NULL,
  `severity` ENUM('info', 'warning') NOT NULL DEFAULT 'info',
  `expires_at` DATETIME NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_announcements_team` (`team`, `expires_at`),
  CONSTRAINT `fk_custom_announcements_team` FOREIGN KEY (`team`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_announcements_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
