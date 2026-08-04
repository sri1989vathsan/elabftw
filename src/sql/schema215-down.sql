UPDATE config SET conf_value = 214 WHERE conf_name = 'schema';

ALTER TABLE `todolist`
  DROP KEY `idx_todolist_user_completed`,
  DROP COLUMN `completed_at`;
