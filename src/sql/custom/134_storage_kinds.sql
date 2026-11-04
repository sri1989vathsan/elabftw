-- Fork migration 134: kinds of storage places made by an admin ("incubator", "dewar", "shelf"...), each behaving like one of the kinds that exist:
-- a location, a cooler (a fridge or a freezer: it has a temperature and holds racks), a rack or a box. The kind of a place can be longer now.
CREATE TABLE IF NOT EXISTS `storage_kinds` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(40) NOT NULL,
    `behaves_like` VARCHAR(12) NOT NULL,
    `default_temperature` SMALLINT NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_storage_kinds_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE `storage_units` MODIFY `kind` VARCHAR(40) NULL DEFAULT NULL;
