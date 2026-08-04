-- Schema 207
-- Add hierarchical folders for experiments
CREATE TABLE IF NOT EXISTS `experiments_folders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `parent_id` INT UNSIGNED NULL DEFAULT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `ordering` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`parent_id`) REFERENCES `experiments_folders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`team`) REFERENCES `teams`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`userid`) REFERENCES `users`(`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Add folder_id column to experiments table (idempotent: skip if column already exists)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiments' AND COLUMN_NAME = 'folder_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE `experiments` ADD COLUMN `folder_id` INT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key (idempotent: skip if constraint already exists)
CALL drop_fk_if_exists('experiments', 'folder_id');
ALTER TABLE `experiments` ADD CONSTRAINT `fk_experiments_folder_id` FOREIGN KEY (`folder_id`) REFERENCES `experiments_folders`(`id`) ON DELETE SET NULL;

-- Add booking cost tracking columns
ALTER TABLE `items` ADD `booking_hourly_rate_notax` DECIMAL(10, 2) UNSIGNED NOT NULL DEFAULT 0.00;
ALTER TABLE `items` ADD `booking_hourly_rate_tax` DECIMAL(10, 2) UNSIGNED NOT NULL DEFAULT 0.00;
ALTER TABLE `items` ADD `booking_hourly_rate_currency` TINYINT UNSIGNED NOT NULL DEFAULT 0;

UPDATE config SET conf_value = 207 WHERE conf_name = 'schema';
