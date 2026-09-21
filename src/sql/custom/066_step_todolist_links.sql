-- Fork migration 066: reflect a step's deadline as a linked to-do task, so
-- it shows up on the team's Todolist board instead of only living on the
-- experiment/resource's own Steps tab. One link per step (entity_type +
-- step_id, since steps live in a different table per entity type); deleting
-- the to-do (ON DELETE CASCADE) drops the link, letting the step's own
-- deadline stand on its own again without a dangling reference.
CREATE TABLE IF NOT EXISTS `custom_step_todolist_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type` VARCHAR(32) NOT NULL,
  `step_id` INT UNSIGNED NOT NULL,
  `todolist_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_custom_step_todolist_links_step` (`entity_type`, `step_id`),
  KEY `idx_custom_step_todolist_links_todolist` (`todolist_id`),
  CONSTRAINT `fk_custom_step_todolist_links_todolist` FOREIGN KEY (`todolist_id`) REFERENCES `todolist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
