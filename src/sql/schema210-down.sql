-- Revert schema 210
DROP TABLE `favcategories2users`;
UPDATE config SET conf_value = 209 WHERE conf_name = 'schema';
