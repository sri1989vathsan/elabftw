-- Fork migration 096: a free-form canvas per project board. A card is a question, a pointer to an existing
-- to-do task, or a pointer to an experiment, placed at x/y inside its own project's space; an edge is an
-- arrow between two cards. Pointers are by id (the card shows the live task/experiment), so a deleted task
-- leaves its card behind as a placeholder instead of silently vanishing.
CREATE TABLE IF NOT EXISTS `todolist_canvas_nodes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `project_id` INT UNSIGNED NOT NULL,
  `type` ENUM('question','task','experiment') NOT NULL,
  `x` INT NOT NULL DEFAULT 0,
  `y` INT NOT NULL DEFAULT 0,
  `title` VARCHAR(255) NULL,
  `note` TEXT NULL,
  `task_id` INT UNSIGNED NULL,
  `entity_id` INT UNSIGNED NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_canvas_nodes_project` (`project_id`),
  INDEX `idx_canvas_nodes_task` (`task_id`),
  CONSTRAINT `fk_canvas_nodes_project` FOREIGN KEY (`project_id`) REFERENCES `todolist_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `todolist_canvas_edges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `from_node` INT UNSIGNED NOT NULL,
  `to_node` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canvas_edge` (`from_node`, `to_node`),
  INDEX `idx_canvas_edges_to` (`to_node`),
  CONSTRAINT `fk_canvas_edges_from` FOREIGN KEY (`from_node`) REFERENCES `todolist_canvas_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canvas_edges_to` FOREIGN KEY (`to_node`) REFERENCES `todolist_canvas_nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
