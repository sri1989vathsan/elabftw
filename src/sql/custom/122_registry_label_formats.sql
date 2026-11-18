-- Fork migration 122: the label printing of the database. An admin adds label formats (a size, a margin, a text size, whether there is a QR
-- code, and the lines of text) for the label printer of the lab, and sets where the printer is on the network
CREATE TABLE IF NOT EXISTS `registry_label_formats` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `team` INT UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `width_mm` DECIMAL(6,2) NOT NULL,
    `height_mm` DECIMAL(6,2) NOT NULL,
    `margin_mm` DECIMAL(5,2) NOT NULL DEFAULT 1.50,
    `font_mm` DECIMAL(5,2) NOT NULL DEFAULT 3.20,
    `qr` TINYINT(1) NOT NULL DEFAULT 1,
    `lines` JSON NULL,
    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_registry_label_formats_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `registry_label_settings` (
    `team` INT UNSIGNED NOT NULL,
    `printer_host` VARCHAR(255) NOT NULL DEFAULT '',
    `printer_port` INT UNSIGNED NOT NULL DEFAULT 9100,
    `dpi` INT UNSIGNED NOT NULL DEFAULT 300,
    `qr_base_url` VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
