-- Fork migration 057: let a Kanban column be hidden from the board without
-- deleting it (and losing whatever tasks are still in it) -- see
-- TodolistColumns.php.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'todolist_columns' AND COLUMN_NAME = 'hidden'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE todolist_columns ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
