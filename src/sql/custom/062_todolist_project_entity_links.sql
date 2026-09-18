-- Fork migration 062: link a to-do project (or subproject) directly to an
-- experiment, template, resource, resource template, or a plain web URL --
-- independent of any single task, mirroring todolist_entity_links (031).
CREATE TABLE IF NOT EXISTS `todolist_project_entity_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `entity_type` VARCHAR(30) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `url` VARCHAR(2000) NULL,
  `label` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_todolist_project_entity_link` (`project_id`, `entity_type`, `entity_id`),
  CONSTRAINT `fk_todolist_project_entity_links_project` FOREIGN KEY (`project_id`) REFERENCES `todolist_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
