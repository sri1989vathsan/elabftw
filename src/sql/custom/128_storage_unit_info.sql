-- Fork migration 128: information about a storage place: where it is (building, room), its temperature or conditions, who looks after it, and
-- notes. In a table of its own, so the storage units of eLabFTW stay as they are
CREATE TABLE IF NOT EXISTS `storage_unit_info` (
    `storage_id` INT UNSIGNED NOT NULL,
    `location` VARCHAR(255) NOT NULL DEFAULT '',
    `conditions` VARCHAR(255) NOT NULL DEFAULT '',
    `contact_users_id` INT UNSIGNED NULL DEFAULT NULL,
    `notes` TEXT NULL,
    `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`storage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
