-- Fork migration 103: the shared table of links behind Links > Others (see Models/OtherLinks.php). Anyone in the team can add one.
CREATE TABLE IF NOT EXISTS `custom_other_links` (
  `id` int UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` int UNSIGNED NOT NULL,
  `userid` int UNSIGNED NULL,
  `title` varchar(255) NOT NULL,
  `url` varchar(2048) NOT NULL,
  `description` varchar(1000) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_other_links_team` (`team`),
  CONSTRAINT `fk_custom_other_links_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
