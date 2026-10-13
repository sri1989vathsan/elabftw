-- Fork migration 085: shared text templates that go with ordering (emails to a
-- supplier, quote requests, ...). Not part of an order itself: the Orders >
-- Templates page lists them for the whole team to copy from; only the author or
-- a team admin edits or deletes one.
CREATE TABLE IF NOT EXISTS `custom_order_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` MEDIUMTEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_order_templates_team` (`team`, `title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
