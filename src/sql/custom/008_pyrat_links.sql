-- Fork migration 008: read-only PyRAT integration and experiment links.
INSERT IGNORE INTO `config` (`conf_name`, `conf_value`) VALUES
  ('pyrat_enabled', '0'),
  ('pyrat_allowed_teams', ''),
  ('pyrat_demo_mode', '1'),
  ('pyrat_base_url', ''),
  ('pyrat_auth_mode', 'basic'),
  ('pyrat_username', ''),
  ('pyrat_password', ''),
  ('pyrat_animals_path', ''),
  ('pyrat_animal_path', ''),
  ('pyrat_cages_path', ''),
  ('pyrat_cage_path', ''),
  ('pyrat_scoresheet_url', ''),
  ('pyrat_verify_tls', '1');

CREATE TABLE IF NOT EXISTS `pyrat_experiment_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `experiment_id` INT UNSIGNED NOT NULL,
  `entity_type` ENUM('animal', 'cage') NOT NULL,
  `pyrat_entity_id` VARCHAR(128) NOT NULL,
  `pyrat_label` VARCHAR(255) NULL DEFAULT NULL,
  `linked_by` INT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pyrat_experiment_link` (`experiment_id`, `entity_type`, `pyrat_entity_id`),
  KEY `idx_pyrat_entity` (`entity_type`, `pyrat_entity_id`),
  KEY `idx_pyrat_linked_by` (`linked_by`),
  CONSTRAINT `fk_custom_pyrat_experiment` FOREIGN KEY (`experiment_id`) REFERENCES `experiments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_custom_pyrat_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`userid`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
