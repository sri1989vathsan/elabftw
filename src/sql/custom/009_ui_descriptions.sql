-- Fork migration 009: short descriptions for custom UI groupings.
--
-- Keep this metadata in a fork-owned table instead of altering upstream
-- category tables. This avoids consuming an official eLabFTW schema number
-- and minimizes conflicts when upstream migrations add category fields.
CREATE TABLE IF NOT EXISTS `custom_ui_descriptions` (
  `scope` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
