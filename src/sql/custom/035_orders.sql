-- Fork migration 035: a team-scoped orders/requests board, replacing the
-- external Trello board previously used to track "please order this" items.
-- Unlike the native procurement_requests table, an order here does not
-- require an existing procurable resource -- item_id is optional -- and
-- supports a discussion thread the same way the feedback board does.
CREATE TABLE IF NOT EXISTS `custom_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `notes` TEXT NULL,
  `item_id` INT UNSIGNED NULL,
  `status` ENUM('requested', 'ordered', 'received', 'cancelled') NOT NULL DEFAULT 'requested',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_orders_team` (`team`, `status`, `created_at`),
  KEY `idx_custom_orders_item` (`item_id`),
  CONSTRAINT `fk_custom_orders_item` FOREIGN KEY (`item_id`)
    REFERENCES `items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `custom_order_comments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `body` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_order_comments_order` (`order_id`, `created_at`),
  CONSTRAINT `fk_custom_order_comments_order` FOREIGN KEY (`order_id`)
    REFERENCES `custom_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
