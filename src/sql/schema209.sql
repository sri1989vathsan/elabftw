-- Schema 208
-- Add favorite experiment folder per user
ALTER TABLE `users` ADD COLUMN `favorite_experiment_folder` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `users` ADD CONSTRAINT `fk_users_fav_exp_folder` FOREIGN KEY (`favorite_experiment_folder`) REFERENCES `experiments_folders`(`id`) ON DELETE SET NULL;

UPDATE config SET conf_value = 208 WHERE conf_name = 'schema';
