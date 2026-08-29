-- Fork migration 017: version number for experiment templates.
--
-- Bumped and the template locked automatically when a pending Review
-- request is approved (see the Action::Review branch in
-- AbstractEntity::patch()), so an approved template reads like a numbered
-- SOP revision rather than an editable document with no history marker.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments_templates' AND COLUMN_NAME = 'version');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments_templates` ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
