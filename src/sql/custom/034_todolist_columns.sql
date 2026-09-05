-- Fork migration 034: user-configurable Kanban columns for the project
-- management board, beyond the fixed To do/In progress/Done trio.
CREATE TABLE IF NOT EXISTS `todolist_columns` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `kind` ENUM('todo', 'in_progress', 'done', 'custom') NOT NULL DEFAULT 'custom',
  `ordering` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_todolist_columns_team` FOREIGN KEY (`team`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed the three built-in columns for every existing team (new teams get
-- them via TodolistColumns::createDefault(), called from Teams::create()).
INSERT INTO todolist_columns (team, name, kind, ordering)
SELECT t.id, 'To do', 'todo', 0 FROM teams t
WHERE NOT EXISTS (SELECT 1 FROM todolist_columns c WHERE c.team = t.id AND c.kind = 'todo');

INSERT INTO todolist_columns (team, name, kind, ordering)
SELECT t.id, 'In progress', 'in_progress', 1 FROM teams t
WHERE NOT EXISTS (SELECT 1 FROM todolist_columns c WHERE c.team = t.id AND c.kind = 'in_progress');

INSERT INTO todolist_columns (team, name, kind, ordering)
SELECT t.id, 'Done', 'done', 2 FROM teams t
WHERE NOT EXISTS (SELECT 1 FROM todolist_columns c WHERE c.team = t.id AND c.kind = 'done');

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist' AND COLUMN_NAME = 'column_id');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `todolist` ADD COLUMN `column_id` INT UNSIGNED NULL AFTER `priority`, ADD CONSTRAINT `fk_todolist_column` FOREIGN KEY (`column_id`) REFERENCES `todolist_columns` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- Backfill existing tasks into their team's matching built-in column, based
-- on their current completed_at/in_progress state.
UPDATE todolist AS t
INNER JOIN todolist_columns AS c ON c.team = t.team AND c.kind = (
    CASE
        WHEN t.completed_at IS NOT NULL THEN 'done'
        WHEN t.in_progress = 1 THEN 'in_progress'
        ELSE 'todo'
    END
)
SET t.column_id = c.id
WHERE t.column_id IS NULL;
