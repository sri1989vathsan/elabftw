-- Fork migration 148: who looked at the personal modules of whom (the owner sees it in "My modules...").
CREATE TABLE IF NOT EXISTS `personal_module_views` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `viewer` INT UNSIGNED NOT NULL,
  `owner` INT UNSIGNED NOT NULL,
  `viewed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `personal_module_views_owner` (`owner`, `viewed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
