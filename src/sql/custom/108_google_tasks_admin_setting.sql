-- Fork migration 108: administrator switch for the optional Google Tasks sync.
-- Off by default. When off, the to-do panel does not render the sync section and
-- the browser code never starts. The client ID can be set once for the whole server.
INSERT IGNORE INTO `config` (`conf_name`, `conf_value`) VALUES
  ('google_tasks_enabled', '0'),
  ('google_tasks_client_id', '');
