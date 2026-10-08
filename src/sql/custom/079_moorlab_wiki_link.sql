-- Fork migration 079: per-team editable link to the MoorLab wiki.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = 'moorlab_wiki_url');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `teams` ADD COLUMN `moorlab_wiki_url` VARCHAR(255) NULL DEFAULT ''https://wiki-bsse.ethz.ch/spaces/DBSSEMOOR/pages/213941413/D-BSSE+Moor+Group+Home''', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

UPDATE `teams` SET `moorlab_wiki_url` = 'https://wiki-bsse.ethz.ch/spaces/DBSSEMOOR/pages/213941413/D-BSSE+Moor+Group+Home' WHERE `moorlab_wiki_url` IS NULL;
