-- Fork migration 123: a label format has its own bottom margin (the labels of small tubes keep more room at the bottom), and every team
-- that has no format gets the 29 x 11 mm label of the lab as its default one
ALTER TABLE `registry_label_formats` ADD COLUMN `margin_bottom_mm` DECIMAL(5,2) NULL DEFAULT NULL;
INSERT INTO `registry_label_formats` (`team`, `name`, `width_mm`, `height_mm`, `margin_mm`, `margin_bottom_mm`, `font_mm`, `qr`, `lines`, `is_default`)
    SELECT t.`id`, '29 x 11 mm', 29, 11, 1.00, 3.00, 2.60, 1, JSON_ARRAY('{id_line}', '{title}'), 1
    FROM `teams` AS t
    WHERE NOT EXISTS (SELECT 1 FROM `registry_label_formats` AS f WHERE f.`team` = t.`id`);
