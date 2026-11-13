-- Fork migration 152: the Backbone finder keeps what it worked out from the sequence files (backbone.inc.php) in this table as well as in a file of the
-- server's temporary folder, so that it is not lost when the container is restarted or replaced (the first request after that read every file again, ~2 s).
CREATE TABLE IF NOT EXISTS `backbone_cache` (
  `team` INT UNSIGNED NOT NULL,
  `name` VARCHAR(32) NOT NULL,
  `ckey` VARCHAR(64) NOT NULL,
  `data` LONGBLOB NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`team`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
