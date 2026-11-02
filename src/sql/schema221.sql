-- schema 221
-- the folders of the database: the same folders as the experiments and the resources have, with a tree of their own. A folder
-- has a scope (experiments, which is also the scope of the resources, or inventory); the entries of the inventory use folder_id
-- like the other entries
ALTER TABLE `experiments_folders`
    ADD COLUMN `scope` VARCHAR(16) NOT NULL DEFAULT 'experiments',
    ADD COLUMN `legacy_registry_id` INT UNSIGNED NULL,
    ADD INDEX `idx_experiments_folders_scope` (`team`, `scope`, `parent_id`);

-- the folders the database had before (a table of their own) are moved over, with the folder of each entry
CREATE TABLE IF NOT EXISTS `registry_folders` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `team` int unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` int unsigned DEFAULT NULL,
  `userid` int unsigned NOT NULL,
  `ordering` int unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `registry_folder_entries` (
  `entry_id` int unsigned NOT NULL,
  `folder_id` int unsigned NOT NULL,
  PRIMARY KEY (`entry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `experiments_folders` (`team`, `name`, `parent_id`, `userid`, `ordering`, `created_at`, `modified_at`, `scope`, `legacy_registry_id`)
    SELECT `team`, `name`, NULL, `userid`, `ordering`, `created_at`, `modified_at`, 'inventory', `id` FROM `registry_folders`;
UPDATE `experiments_folders` AS child
    JOIN `registry_folders` AS old ON old.id = child.legacy_registry_id
    JOIN `experiments_folders` AS parent ON parent.legacy_registry_id = old.parent_id AND parent.scope = 'inventory'
    SET child.parent_id = parent.id
    WHERE child.scope = 'inventory';
UPDATE `inventory` AS entry
    JOIN `registry_folder_entries` AS link ON link.entry_id = entry.id
    JOIN `experiments_folders` AS folder ON folder.legacy_registry_id = link.folder_id AND folder.scope = 'inventory'
    SET entry.folder_id = folder.id;
ALTER TABLE `experiments_folders` DROP COLUMN `legacy_registry_id`;
