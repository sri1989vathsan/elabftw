-- Fork migration 019: keep a permanent snapshot of each published template
-- version.
--
-- The version column added in 017_template_version.sql is only a counter --
-- publishing a new version bumps it and locks the template, but nothing
-- keeps what the body actually looked like at that version. Ordinary
-- revisions (see Revisions.php) are pruned (max 10, dropped once superseded)
-- and gated on a size/time delta, so they can't safely serve as "version 3
-- looked like this" -- it needs its own permanent, ungated copy.
CREATE TABLE IF NOT EXISTS `custom_template_versions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_id` INT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `body` LONGTEXT NOT NULL,
  `published_by` INT UNSIGNED NOT NULL,
  `published_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_custom_template_versions_entity_version` (`entity_id`, `version`),
  KEY `idx_custom_template_versions_entity` (`entity_id`, `published_at`),
  CONSTRAINT `fk_custom_template_versions_published_by`
    FOREIGN KEY (`published_by`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
