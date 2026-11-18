-- Fork migration 155: every team has the label format "Fisher" (37 x 15 mm, one line '{id_line} {title}'), chosen first. A team that already
-- has a format of that name keeps it untouched. The 31 x 15 mm format that migration 123 made for the teams is taken off as the first-chosen one only
-- when it still has exactly the values of 123 (nobody changed it); it stays in the list. A team that has no first-chosen format gets Fisher as it.
UPDATE `registry_label_formats` AS f
    SET f.`is_default` = 0
    WHERE f.`is_default` = 1
        AND f.`name` = '31 x 15 mm' AND f.`width_mm` = 31 AND f.`height_mm` = 15 AND f.`margin_mm` = 1.00
        AND f.`margin_left_mm` = 2.20 AND f.`margin_top_mm` = 1.80 AND f.`margin_right_mm` = 1.00 AND f.`margin_bottom_mm` = 1.00
        AND f.`offset_x_mm` = 0 AND f.`offset_y_mm` = 0 AND f.`font_mm` = 2.90 AND f.`qr` = 0 AND f.`rotate_180` = 1
        AND NOT EXISTS (SELECT 1 FROM (SELECT `team` FROM `registry_label_formats` WHERE `name` = 'Fisher') AS x WHERE x.`team` = f.`team`);
INSERT INTO `registry_label_formats` (`team`, `name`, `width_mm`, `height_mm`, `margin_mm`, `margin_left_mm`, `margin_top_mm`, `margin_right_mm`, `margin_bottom_mm`, `offset_x_mm`, `offset_y_mm`, `font_mm`, `qr`, `rotate_180`, `lines`, `is_default`)
    SELECT t.`id`, 'Fisher', 37, 15, 0.00, 0.00, 1.00, 0.00, 3.00, 5.00, 1.50, 3.00, 0, 0, JSON_ARRAY('{id_line} {title}'),
        IF(EXISTS (SELECT 1 FROM `registry_label_formats` AS d WHERE d.`team` = t.`id` AND d.`is_default` = 1), 0, 1)
    FROM `teams` AS t
    WHERE NOT EXISTS (SELECT 1 FROM `registry_label_formats` AS f WHERE f.`team` = t.`id` AND f.`name` = 'Fisher');
