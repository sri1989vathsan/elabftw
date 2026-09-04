-- Fork migration 029: allow a to-do task to be assigned to multiple teammates.
CREATE TABLE IF NOT EXISTS `todolist_task_assignees` (
  `task_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`task_id`, `userid`),
  CONSTRAINT `fk_custom_todolist_task_assignees_task` FOREIGN KEY (`task_id`) REFERENCES `todolist` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_todolist_task_assignees_user` FOREIGN KEY (`userid`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- backfill: every existing task's single assignee becomes its one row here
INSERT IGNORE INTO `todolist_task_assignees` (`task_id`, `userid`)
    SELECT `id`, `assigned_userid` FROM `todolist` WHERE `assigned_userid` IS NOT NULL;
