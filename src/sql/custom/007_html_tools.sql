-- Fork migration 007: persistent administrator-managed HTML tools.
CREATE TABLE IF NOT EXISTS `html_tools` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `version` VARCHAR(64) NOT NULL DEFAULT '',
  `entrypoint` VARCHAR(512) NOT NULL DEFAULT 'index.html',
  `enabled` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `uploaded_by` INT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_html_tools_enabled_name` (`enabled`, `name`),
  KEY `idx_html_tools_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_custom_html_tools_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`userid`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
