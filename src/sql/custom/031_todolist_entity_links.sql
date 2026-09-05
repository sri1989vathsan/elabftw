-- Fork migration 031: link a to-do task to an experiment, template, resource,
-- resource template, or a plain web URL.
CREATE TABLE IF NOT EXISTS `todolist_entity_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` INT UNSIGNED NOT NULL,
  `entity_type` VARCHAR(30) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `url` VARCHAR(2000) NULL,
  `label` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_todolist_entity_link` (`task_id`, `entity_type`, `entity_id`),
  CONSTRAINT `fk_todolist_entity_links_task` FOREIGN KEY (`task_id`) REFERENCES `todolist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
