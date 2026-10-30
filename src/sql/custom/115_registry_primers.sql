-- Fork migration 115: primers attached to plasmids of the database. A primer entry can be attached to any number of plasmids
-- and a plasmid has any number of primers; where a primer binds is worked out from the sequence of the plasmid.
CREATE TABLE IF NOT EXISTS `inventory_primer_links` (
    `plasmid_id` INT UNSIGNED NOT NULL,
    `primer_id` INT UNSIGNED NOT NULL,
    `users_id` INT UNSIGNED NULL DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`plasmid_id`, `primer_id`),
    KEY `idx_inventory_primer_links_primer` (`primer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
