-- revert schema 208
ALTER TABLE `users` DROP FOREIGN KEY `fk_users_fav_exp_folder`;
ALTER TABLE `users` DROP COLUMN `favorite_experiment_folder`;
UPDATE config SET conf_value = 207 WHERE conf_name = 'schema';
