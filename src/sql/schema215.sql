-- Schema 215
-- Retain completed personal to-dos so users can browse their task history.
ALTER TABLE `todolist`
  ADD COLUMN `completed_at` datetime NULL AFTER `reminder_minutes`,
  ADD KEY `idx_todolist_user_completed` (`userid`, `completed_at`);

UPDATE config SET conf_value = 215 WHERE conf_name = 'schema';
