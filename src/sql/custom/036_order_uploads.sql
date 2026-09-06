-- Fork migration 036: attachments (receipts, quotes, ...) on an order.
-- Files are written to the instance's configured storage backend the same
-- way the native uploads table does, and served back through the existing
-- app/download.php endpoint (which only needs long_name + storage, no
-- entity-specific lookup) -- so no new download code path is needed.
CREATE TABLE IF NOT EXISTS `custom_order_uploads` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `real_name` VARCHAR(255) NOT NULL,
  `long_name` VARCHAR(255) NOT NULL,
  `storage` INT UNSIGNED NOT NULL DEFAULT 1,
  `filesize` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_order_uploads_order` (`order_id`),
  CONSTRAINT `fk_custom_order_uploads_order` FOREIGN KEY (`order_id`)
    REFERENCES `custom_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
