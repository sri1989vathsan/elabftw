-- Fork migration 051: let projects be reordered by drag-and-drop on the
-- Project Management board, same idea as todolist_columns.ordering.
-- Seeded here in creation order (created_at, then id as a tiebreak) so
-- existing installs get a sensible default without anyone having to drag
-- anything -- see TodolistProjects.php.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_projects' AND COLUMN_NAME = 'ordering'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_projects ADD COLUMN ordering INT NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE todolist_projects AS p
INNER JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY team ORDER BY created_at ASC, id ASC) - 1 AS rn
    FROM todolist_projects
) AS ranked ON ranked.id = p.id
SET p.ordering = ranked.rn;
