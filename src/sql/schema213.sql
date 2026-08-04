-- Schema 213
-- Add optional calendar scheduling to personal to-do items.
ALTER TABLE `todolist`
  ADD COLUMN `notes` text NULL AFTER `body`,
  ADD COLUMN `deadline` datetime NULL AFTER `notes`,
  ADD COLUMN `reminder_minutes` smallint UNSIGNED NULL DEFAULT 60 AFTER `deadline`,
  ADD KEY `idx_todolist_user_deadline` (`userid`, `deadline`);

UPDATE config SET conf_value = 213 WHERE conf_name = 'schema';
