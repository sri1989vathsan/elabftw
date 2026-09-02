-- Fork migration 023: a team-scoped bug/feature board. Any team member can
-- post an item and any team member can upvote it, so the team can see what
-- matters most to people without needing an admin to curate the list.
CREATE TABLE IF NOT EXISTS `custom_feedback_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `type` ENUM('bug', 'feature') NOT NULL DEFAULT 'feature',
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NULL,
  `status` ENUM('open', 'planned', 'done', 'declined') NOT NULL DEFAULT 'open',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_feedback_items_team` (`team`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `custom_feedback_votes` (
  `item_id` INT UNSIGNED NOT NULL,
  `userid` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`item_id`, `userid`),
  KEY `idx_custom_feedback_votes_userid` (`userid`),
  CONSTRAINT `fk_custom_feedback_votes_item` FOREIGN KEY (`item_id`)
    REFERENCES `custom_feedback_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
