-- Fork migration 142: the parts of a plasmid (feature names read from its attached GenBank files) for the search by meaning.
-- One row per entry that has a sequence file. 'labels' are the feature names joined with '|'; 'sig' says which files they were read from, so a changed attachment is read again.
CREATE TABLE IF NOT EXISTS `ai_search_features` (
  `entity_type` VARCHAR(16) NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `team` INT UNSIGNED NOT NULL,
  `sig` CHAR(40) NOT NULL,
  `labels` TEXT NULL,
  `read_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entity_type`, `entity_id`),
  KEY `ai_search_features_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
