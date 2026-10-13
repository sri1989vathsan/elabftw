-- Fork migration 086: files (images, PDFs, ...) attached to an order template.
-- Same storage and download path as order attachments (migration 036); images are
-- shown as small clickable thumbnails on the Templates page.
CREATE TABLE IF NOT EXISTS `custom_order_template_uploads` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `real_name` VARCHAR(255) NOT NULL,
  `long_name` VARCHAR(255) NOT NULL,
  `storage` INT UNSIGNED NOT NULL DEFAULT 1,
  `filesize` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_order_template_uploads_template` (`template_id`),
  CONSTRAINT `fk_custom_order_template_uploads_template` FOREIGN KEY (`template_id`)
    REFERENCES `custom_order_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
