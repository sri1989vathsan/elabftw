-- Fork migration 065: let an announcement carry a photo (image_url, shown
-- in the "tweet card" on the dashboard) and let team members react to it
-- with a small fixed set of emoji, one reaction per user per announcement.
ALTER TABLE `custom_announcements`
  ADD COLUMN `image_url` VARCHAR(2048) NULL DEFAULT NULL AFTER `body`;

CREATE TABLE IF NOT EXISTS `custom_announcement_reactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `announcement_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `emoji` VARCHAR(8) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_custom_announcement_reactions_user` (`announcement_id`, `userid`),
  KEY `idx_custom_announcement_reactions_announcement` (`announcement_id`),
  CONSTRAINT `fk_custom_announcement_reactions_announcement` FOREIGN KEY (`announcement_id`) REFERENCES `custom_announcements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_announcement_reactions_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
