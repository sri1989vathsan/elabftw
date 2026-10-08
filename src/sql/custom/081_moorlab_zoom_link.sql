-- Fork migration 081: per-team editable link to the MoorLab Zoom room.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'moorlab_zoom_url');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `moorlab_zoom_url` VARCHAR(255) NULL DEFAULT ''https://ethz.zoom.us/j/6870256161''', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

UPDATE `teams` SET `moorlab_zoom_url` = 'https://ethz.zoom.us/j/6870256161' WHERE `moorlab_zoom_url` IS NULL;
