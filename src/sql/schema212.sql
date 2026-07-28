-- Schema 212
-- Add account and entity scoped defaults for inline spreadsheet appearance.
ALTER TABLE `users`
  ADD COLUMN `spreadsheet_defaults` JSON NULL DEFAULT NULL;

ALTER TABLE `experiments`
  ADD COLUMN `spreadsheet_defaults` JSON NULL DEFAULT NULL;

ALTER TABLE `experiments_templates`
  ADD COLUMN `spreadsheet_defaults` JSON NULL DEFAULT NULL;

ALTER TABLE `items`
  ADD COLUMN `spreadsheet_defaults` JSON NULL DEFAULT NULL;

ALTER TABLE `items_types`
  ADD COLUMN `spreadsheet_defaults` JSON NULL DEFAULT NULL;

UPDATE config SET conf_value = 212 WHERE conf_name = 'schema';
