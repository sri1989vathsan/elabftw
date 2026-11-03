-- Fork migration 123: a label format has a margin for each side (left, top, right, bottom), an offset (to move the whole print) and can be
-- printed upside down (the labels of the lab are read turned by 180 degrees). The margin of the format stays the fallback of the sides that
-- are empty. Every team that has no format gets the label of the lab as its default one: 31 x 15 mm, 366 x 177 dots at 300 dpi, as the
-- label software of the printer prints it
ALTER TABLE `registry_label_formats`
    ADD COLUMN `margin_left_mm` DECIMAL(5,2) NULL DEFAULT NULL,
    ADD COLUMN `margin_top_mm` DECIMAL(5,2) NULL DEFAULT NULL,
    ADD COLUMN `margin_right_mm` DECIMAL(5,2) NULL DEFAULT NULL,
    ADD COLUMN `margin_bottom_mm` DECIMAL(5,2) NULL DEFAULT NULL,
    ADD COLUMN `offset_x_mm` DECIMAL(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN `offset_y_mm` DECIMAL(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN `rotate_180` TINYINT(1) NOT NULL DEFAULT 0;
INSERT INTO `registry_label_formats` (`team`, `name`, `width_mm`, `height_mm`, `margin_mm`, `margin_left_mm`, `margin_top_mm`, `margin_right_mm`, `margin_bottom_mm`, `font_mm`, `qr`, `rotate_180`, `lines`, `is_default`)
    SELECT t.`id`, '31 x 15 mm', 31, 15, 1.00, 2.20, 1.80, 1.00, 1.00, 2.90, 0, 1, JSON_ARRAY('{id_line}', '{title}'), 1
    FROM `teams` AS t
    WHERE NOT EXISTS (SELECT 1 FROM `registry_label_formats` AS f WHERE f.`team` = t.`id`);
