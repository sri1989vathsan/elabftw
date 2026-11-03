-- Fork migration 125: the columns a user hides or adds in the tables of the database, kept for each user and module (a module key is the id
-- of the module, or "mixed" for the lists that have several modules), so they follow the account to any browser
CREATE TABLE IF NOT EXISTS `registry_column_prefs` (
    `users_id` INT UNSIGNED NOT NULL,
    `module_key` VARCHAR(20) NOT NULL,
    `hidden` JSON NULL,
    `extra` JSON NULL,
    `modified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`users_id`, `module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
