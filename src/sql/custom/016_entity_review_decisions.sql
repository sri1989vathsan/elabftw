-- Fork migration 016: record the outcome of a review request instead of
-- silently discarding it. Upstream's Action::Review currently does nothing
-- but close the pending request (see the "TODO leave a comment" in
-- AbstractEntity::patch()) -- no decision, no comment, no record of who
-- reviewed what or when. This keeps a permanent audit trail per entity,
-- and a snapshot of the approved body: ordinary revisions are pruned
-- (max 10, dropped once superseded), so an "approved version" can't
-- safely be a pointer into that history -- it has to keep its own copy.
CREATE TABLE IF NOT EXISTS `custom_entity_review_decisions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type` VARCHAR(32) NOT NULL,
  `entity_id` INT UNSIGNED NOT NULL,
  `decision` ENUM('approved', 'rejected') NOT NULL,
  `comment` TEXT NULL,
  `approved_body` LONGTEXT NULL,
  `requested_by` INT UNSIGNED NULL,
  `reviewed_by` INT UNSIGNED NOT NULL,
  `reviewed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_entity_review_decisions_entity` (`entity_type`, `entity_id`, `reviewed_at`),
  CONSTRAINT `fk_custom_entity_review_decisions_requested_by`
    FOREIGN KEY (`requested_by`) REFERENCES `users` (`userid`) ON DELETE SET NULL,
  CONSTRAINT `fk_custom_entity_review_decisions_reviewed_by`
    FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`userid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
