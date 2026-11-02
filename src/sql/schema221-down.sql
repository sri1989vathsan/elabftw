-- revert schema 221
DELETE FROM `experiments_folders` WHERE `scope` = 'inventory';
CALL DropIdx('experiments_folders', 'idx_experiments_folders_scope');
CALL DropColumn('experiments_folders', 'scope');
UPDATE config SET conf_value = 220 WHERE conf_name = 'schema';
