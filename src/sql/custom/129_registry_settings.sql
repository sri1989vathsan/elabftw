-- Fork migration 129: settings of the Database for a team. The default owner is the user who gets imported entries whose owner is not found
CREATE TABLE IF NOT EXISTS `registry_settings` (
    `team` INT UNSIGNED NOT NULL,
    `default_owner` INT UNSIGNED NULL DEFAULT NULL,
    PRIMARY KEY (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
