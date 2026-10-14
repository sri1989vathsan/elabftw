-- Fork migration 090: a step that @-mentions someone is added to that
-- person's to-do list. One row per (step, mentioned user) remembers which
-- to-do task it created, so editing the step updates that task instead of
-- adding another, and removing the mention (or the step) removes it again.
CREATE TABLE IF NOT EXISTS `custom_step_mentions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type` VARCHAR(32) NOT NULL,
  `step_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `todolist_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_custom_step_mentions` (`entity_type`, `step_id`, `userid`),
  KEY `idx_custom_step_mentions_todolist` (`todolist_id`),
  CONSTRAINT `fk_custom_step_mentions_todolist` FOREIGN KEY (`todolist_id`) REFERENCES `todolist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
