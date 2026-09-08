-- Fork migration 032: a simple ordered, checkable step list on assignable to-do tasks.
CREATE TABLE IF NOT EXISTS `custom_todolist_steps` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` INT UNSIGNED NOT NULL,
  `body` VARCHAR(500) NOT NULL,
  `ordering` INT UNSIGNED NOT NULL DEFAULT 0,
  `finished` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_custom_todolist_steps_task` FOREIGN KEY (`task_id`) REFERENCES `todolist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
