-- Fork migration 068: attach an image to an announcement as a real
-- uploaded file (not just a pasted image_url), the same way
-- custom_order_uploads does it for orders -- written to the instance's
-- configured storage backend and served back through the existing
-- app/download.php endpoint (which only needs long_name + storage, no
-- entity-specific lookup), so no new download code path is needed.
CREATE TABLE IF NOT EXISTS `custom_announcement_uploads` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `announcement_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `real_name` VARCHAR(255) NOT NULL,
  `long_name` VARCHAR(255) NOT NULL,
  `storage` INT UNSIGNED NOT NULL DEFAULT 1,
  `filesize` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_announcement_uploads_announcement` (`announcement_id`),
  CONSTRAINT `fk_custom_announcement_uploads_announcement` FOREIGN KEY (`announcement_id`)
    REFERENCES `custom_announcements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
