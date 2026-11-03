-- Fork migration 126: entries of the database linked to experiments and resources. One table for both (entity_type: experiments or items),
-- like the links of the orders; the entries of the database are not in the resources, so the links of the resources do not apply
CREATE TABLE IF NOT EXISTS `inventory_entity_links` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `entity_type` VARCHAR(20) NOT NULL,
    `entity_id` INT UNSIGNED NOT NULL,
    `inventory_id` INT UNSIGNED NOT NULL,
    `users_id` INT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_inventory_entity_link` (`entity_type`, `entity_id`, `inventory_id`),
    KEY `idx_inventory_entity_links_inventory` (`inventory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
