UPDATE config SET conf_value = 211 WHERE conf_name = 'schema';

ALTER TABLE `items_types` DROP COLUMN `spreadsheet_defaults`;
ALTER TABLE `items` DROP COLUMN `spreadsheet_defaults`;
ALTER TABLE `experiments_templates` DROP COLUMN `spreadsheet_defaults`;
ALTER TABLE `experiments` DROP COLUMN `spreadsheet_defaults`;
ALTER TABLE `users` DROP COLUMN `spreadsheet_defaults`;
