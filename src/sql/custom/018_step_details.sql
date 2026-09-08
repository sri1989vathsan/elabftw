-- Fork migration 018: reagent, quantity, and duration fields on protocol steps.
--
-- Turns a step from a plain checklist line into a structured protocol step
-- (reagent used, amount, how long it takes), the same shape used by other
-- ELN protocol builders, without disturbing the existing body/ordering/
-- finished/deadline columns or the four separate *_steps tables per entity
-- type (experiments, items, experiments_templates, items_types).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments_steps' AND COLUMN_NAME = 'reagent');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments_steps` ADD COLUMN `reagent` VARCHAR(255) NULL DEFAULT NULL, ADD COLUMN `quantity` VARCHAR(64) NULL DEFAULT NULL, ADD COLUMN `duration_minutes` SMALLINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items_steps' AND COLUMN_NAME = 'reagent');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `items_steps` ADD COLUMN `reagent` VARCHAR(255) NULL DEFAULT NULL, ADD COLUMN `quantity` VARCHAR(64) NULL DEFAULT NULL, ADD COLUMN `duration_minutes` SMALLINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments_templates_steps' AND COLUMN_NAME = 'reagent');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `experiments_templates_steps` ADD COLUMN `reagent` VARCHAR(255) NULL DEFAULT NULL, ADD COLUMN `quantity` VARCHAR(64) NULL DEFAULT NULL, ADD COLUMN `duration_minutes` SMALLINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items_types_steps' AND COLUMN_NAME = 'reagent');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `items_types_steps` ADD COLUMN `reagent` VARCHAR(255) NULL DEFAULT NULL, ADD COLUMN `quantity` VARCHAR(64) NULL DEFAULT NULL, ADD COLUMN `duration_minutes` SMALLINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
