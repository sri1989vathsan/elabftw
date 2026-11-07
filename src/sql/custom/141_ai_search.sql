-- Fork migration 141: search by meaning with a language model that runs on the lab's own machines (nothing is sent to an outside service).
-- It is OFF until a sysadmin turns it on (ai_search_enabled). The settings are rows of the config table, like pyrat_enabled.
INSERT IGNORE INTO `config` (`conf_name`, `conf_value`) VALUES
  ('ai_search_enabled', '0'),
  ('ai_search_url', 'http://host.docker.internal:11434'),
  ('ai_search_embed_model', 'nomic-embed-text'),
  ('ai_search_chat_model', 'qwen2.5:7b'),
  ('ai_search_explain', '0'),
  ('ai_chat_enabled', '0');

-- one row per entry that was read by the model: the meaning of its text as numbers (float32, packed). It is a copy of the text of the entries, so it
-- is only read by the search, which checks again that the person may read each entry it shows.
CREATE TABLE IF NOT EXISTS `ai_search_index` (
  `entity_type` VARCHAR(16) NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `team` INT UNSIGNED NOT NULL,
  `content_hash` CHAR(40) NOT NULL,
  `model` VARCHAR(100) NOT NULL DEFAULT '',
  `title` VARCHAR(255) NOT NULL DEFAULT '',
  `snippet` VARCHAR(600) NOT NULL DEFAULT '',
  `dims` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `vec` MEDIUMBLOB NOT NULL,
  `indexed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entity_type`, `entity_id`),
  KEY `ai_search_index_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
