-- Fork migration 040: an order can now link multiple Resources items
-- instead of just one. Replaces the single nullable custom_orders.item_id
-- column with a proper join table; existing single links are carried over.
CREATE TABLE IF NOT EXISTS `custom_order_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `item_id` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_custom_order_items` (`order_id`, `item_id`),
  KEY `idx_custom_order_items_order` (`order_id`),
  CONSTRAINT `fk_custom_order_items_order` FOREIGN KEY (`order_id`)
    REFERENCES `custom_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custom_order_items_item` FOREIGN KEY (`item_id`)
    REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO `custom_order_items` (`order_id`, `item_id`)
SELECT `id`, `item_id` FROM `custom_orders` WHERE `item_id` IS NOT NULL;

SET @custom_fk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND CONSTRAINT_NAME = 'fk_custom_orders_item'
);
SET @custom_sql = IF(@custom_fk_exists > 0,
    'ALTER TABLE custom_orders DROP FOREIGN KEY fk_custom_orders_item',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_col_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND COLUMN_NAME = 'item_id'
);
SET @custom_sql = IF(@custom_col_exists > 0,
    'ALTER TABLE custom_orders DROP COLUMN item_id',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
