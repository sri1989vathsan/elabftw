-- Fork migration 024: comments on feedback board items, so people can
-- discuss a bug/feature idea instead of only voting on it.
CREATE TABLE IF NOT EXISTS `custom_feedback_comments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `body` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_feedback_comments_item` (`item_id`, `created_at`),
  CONSTRAINT `fk_custom_feedback_comments_item` FOREIGN KEY (`item_id`)
    REFERENCES `custom_feedback_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
