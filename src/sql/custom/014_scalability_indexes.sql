-- Fork migration 014: indexes and materialized heading data for scalable sidebars.
CREATE TABLE IF NOT EXISTS `custom_calendar_activity_entries` (
  `entity_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `heading_index` INT UNSIGNED NOT NULL,
  `entry_date` DATE NOT NULL,
  `heading_level` TINYINT UNSIGNED NOT NULL,
  `heading_text` VARCHAR(1000) NOT NULL,
  `parent_index` INT UNSIGNED NULL,
  `anchor` VARCHAR(255) NOT NULL DEFAULT '',
  `team_id` INT UNSIGNED NOT NULL,
  `owner_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`entity_type`, `entity_id`, `heading_index`),
  KEY `idx_custom_calendar_activity_date_team` (`entry_date`, `team_id`),
  KEY `idx_custom_calendar_activity_owner_date` (`owner_id`, `entry_date`),
  KEY `idx_custom_calendar_activity_entity_date` (`entity_type`, `entity_id`, `entry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `custom_calendar_activity_index_state` (
  `entity_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `source_modified_at` TIMESTAMP NOT NULL,
  `indexed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entity_type`, `entity_id`),
  KEY `idx_custom_calendar_indexed_at` (`indexed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `experiments_steps`
  ADD INDEX `idx_experiments_steps_open_deadline_item` (`finished`, `deadline`, `item_id`);

ALTER TABLE `items_steps`
  ADD INDEX `idx_items_steps_open_deadline_item` (`finished`, `deadline`, `item_id`);
