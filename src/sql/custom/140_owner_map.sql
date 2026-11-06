-- Fork migration 140: the people of LabCollector matched to the users of eLabFTW (the same person can have another name or e-mail address in each
-- tool). The import uses it to give each entry to the right user: it looks the owner of a row up by e-mail or name here first.
CREATE TABLE IF NOT EXISTS `registry_owner_map` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `lc_name` VARCHAR(255) NOT NULL DEFAULT '',
  `lc_email` VARCHAR(255) NOT NULL DEFAULT '',
  `elab_name` VARCHAR(255) NOT NULL DEFAULT '',
  `elab_email` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `registry_owner_map_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
