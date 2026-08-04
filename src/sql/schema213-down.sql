UPDATE config SET conf_value = 212 WHERE conf_name = 'schema';

ALTER TABLE `todolist`
  DROP KEY `idx_todolist_user_deadline`,
  DROP COLUMN `reminder_minutes`,
  DROP COLUMN `deadline`,
  DROP COLUMN `notes`;
