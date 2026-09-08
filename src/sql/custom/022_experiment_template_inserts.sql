-- Fork migration 022: track every template inserted into an experiment via
-- the "Insert template" editor picker, as a repeatable many-to-many list --
-- created_from_type/created_from_id (upstream columns) only record the
-- single template an experiment was originally created from, and can't
-- represent inserting several different templates (or the same one more
-- than once) into one experiment's body.
CREATE TABLE IF NOT EXISTS `experiment_template_inserts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `experiment_id` INT UNSIGNED NOT NULL,
  `template_id` INT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `inserted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_experiment_template_inserts_experiment` (`experiment_id`, `inserted_at`),
  KEY `idx_experiment_template_inserts_template` (`template_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
