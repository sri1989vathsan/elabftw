-- Fork migration 153: small per-user interface settings (calendar page view, hidden projects, Google calendar sync choices),
-- kept on the server so they follow the user to another browser or computer. One row per user and setting.
CREATE TABLE IF NOT EXISTS `custom_user_ui_prefs` (
  `users_id` INT UNSIGNED NOT NULL,
  `pref_key` VARCHAR(64) NOT NULL,
  `pref_value` TEXT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`users_id`, `pref_key`),
  CONSTRAINT `fk_custom_user_ui_prefs_user` FOREIGN KEY (`users_id`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
