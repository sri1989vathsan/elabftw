-- Fork migration inv_003 (database branch only): the twin tables of the Database, with their columns spelled out. Replaces 110 and 111, which
-- say `CREATE TABLE ... LIKE items` (and items_steps, items_revisions, ...): that needs the upstream table to exist and copies whatever it has
-- at that moment. Upstream dropped items_revisions, so on a fresh install of merged code 110 cannot run; the runner skips 110 and 111 there
-- (InventoryMigrations::REPLACED_WHEN_TABLE_MISSING) and this file runs in their place, at the same position in the list, so 112 and the
-- following find the tables they alter.
--
-- The columns below are the ones 110 and 111 produced (upstream's resource tables at the fork's merge-base plus the columns of the shared
-- fork migrations 003, 011, 014, 018, 105). The columns upstream added to the resource tables since are mirrored one by one by inv_004 and
-- following, which look at what is there, so a database that came from 110 and one that came from this file end with the same tables.
-- containers2inventory has no KEY storage_id: 110 had it (the index upstream's foreign key created) but 112 adds UNIQUE (storage_id, position), which
-- makes MySQL drop it, so no database ends with it. No foreign keys, as with LIKE. Where 110 already created a table this does nothing.
CREATE TABLE IF NOT EXISTS `inventory` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `team` int unsigned NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_from_id` int unsigned DEFAULT NULL,
  `created_from_type` tinyint unsigned DEFAULT NULL,
  `date` date NOT NULL,
  `body` mediumtext,
  `elabid` varchar(255) NOT NULL,
  `rating` tinyint unsigned NOT NULL DEFAULT '0',
  `category` int unsigned DEFAULT NULL,
  `custom_id` int unsigned DEFAULT NULL,
  `locked` tinyint unsigned NOT NULL DEFAULT '0',
  `lockedby` int unsigned DEFAULT NULL,
  `locked_at` timestamp NULL DEFAULT NULL,
  `userid` int unsigned NOT NULL,
  `canread_base` tinyint unsigned NOT NULL DEFAULT '30',
  `canwrite_base` tinyint unsigned NOT NULL DEFAULT '20',
  `canread` json NOT NULL,
  `canwrite` json NOT NULL,
  `canread_is_immutable` tinyint unsigned NOT NULL DEFAULT '0',
  `canwrite_is_immutable` tinyint unsigned NOT NULL DEFAULT '0',
  `canbook_base` tinyint unsigned NOT NULL DEFAULT '30',
  `canbook` json NOT NULL,
  `content_type` tinyint NOT NULL DEFAULT '1',
  `available` tinyint unsigned NOT NULL DEFAULT '1',
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lastchangeby` int unsigned DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `hide_main_text` tinyint unsigned NOT NULL DEFAULT '0',
  `state` int unsigned NOT NULL DEFAULT '1',
  `status` int unsigned DEFAULT NULL,
  `signature_count` int unsigned NOT NULL DEFAULT '0',
  `last_signed_at` timestamp NULL DEFAULT NULL,
  `last_signed_by` int unsigned DEFAULT NULL,
  `timestamped` tinyint unsigned NOT NULL DEFAULT '0',
  `timestampedby` int DEFAULT NULL,
  `timestamped_at` timestamp NULL DEFAULT NULL,
  `access_key` varchar(36) DEFAULT NULL,
  `is_bookable` tinyint unsigned NOT NULL DEFAULT '0',
  `book_max_minutes` int unsigned NOT NULL DEFAULT '0',
  `book_max_slots` int unsigned NOT NULL DEFAULT '0',
  `book_can_overlap` tinyint unsigned NOT NULL DEFAULT '1',
  `book_users_can_in_past` tinyint unsigned NOT NULL DEFAULT '0',
  `book_is_cancellable` tinyint unsigned NOT NULL DEFAULT '1',
  `book_cancel_minutes` int unsigned NOT NULL DEFAULT '0',
  `booking_window_days` tinyint unsigned NOT NULL DEFAULT '0',
  `booking_hourly_rate_notax` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `booking_hourly_rate_tax` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `booking_hourly_rate_currency` tinyint unsigned NOT NULL DEFAULT '0',
  `is_procurable` tinyint unsigned NOT NULL DEFAULT '0',
  `proc_pack_qty` mediumint unsigned NOT NULL DEFAULT '0',
  `proc_price_notax` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `proc_price_tax` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `proc_currency` tinyint unsigned NOT NULL DEFAULT '0',
  `spreadsheet_defaults` json DEFAULT NULL,
  `folder_id` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_items_custom_id` (`category`,`custom_id`),
  KEY `fk_items_teams_id` (`team`),
  KEY `idx_items_state` (`state`),
  KEY `fk_items_users_userid` (`userid`),
  KEY `fk_items_category_items_categories_id` (`category`),
  KEY `idx_items_state_date_id` (`state`,`date`,`id`),
  KEY `idx_items_state_modified_id` (`state`,`modified_at`,`id`),
  KEY `idx_items_user_state_modified_id` (`userid`,`state`,`modified_at`,`id`),
  KEY `fk_custom_items_folder` (`folder_id`),
  KEY `idx_items_state_folder_modified` (`state`,`folder_id`,`modified_at`),
  FULLTEXT KEY `idx_items_q` (`title`,`body`,`elabid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_categories` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `team` int unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `color` varchar(6) NOT NULL,
  `is_private` tinyint unsigned NOT NULL DEFAULT '1',
  `ordering` int unsigned DEFAULT NULL,
  `state` int unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `fk_items_categories_teams_id` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_status` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `team` int unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `color` varchar(6) NOT NULL,
  `is_private` tinyint unsigned NOT NULL DEFAULT '1',
  `ordering` int unsigned DEFAULT NULL,
  `state` int unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `fk_items_status_teams_team_id` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_changelog` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `entity_id` int unsigned NOT NULL,
  `users_id` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `target` varchar(255) NOT NULL,
  `content` text,
  PRIMARY KEY (`id`),
  KEY `fk_items_changelog2items_id` (`entity_id`),
  KEY `fk_items_changelog2users_userid` (`users_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_comments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `item_id` int unsigned NOT NULL,
  `comment` text NOT NULL,
  `userid` int unsigned NOT NULL,
  `immutable` tinyint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_items_comments_items_id` (`item_id`),
  KEY `fk_items_comments_users_userid` (`userid`),
  KEY `idx_items_comments_item_created` (`item_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_revisions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int unsigned NOT NULL,
  `body` mediumtext NOT NULL,
  `content_type` tinyint NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `userid` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_items_revisions_items_id` (`item_id`),
  KEY `fk_items_revisions_users_userid` (`userid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_edit_mode` (
  `entity_id` int unsigned NOT NULL,
  `locked_by` int unsigned NOT NULL,
  `locked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`entity_id`),
  KEY `fk_items_edit_mode_users_userid` (`locked_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `pin_inventory2users` (
  `users_id` int unsigned NOT NULL,
  `entity_id` int unsigned NOT NULL,
  PRIMARY KEY (`users_id`,`entity_id`),
  KEY `fk_pin_items2users_userid` (`users_id`),
  KEY `fk_pin_items2items_id` (`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory2inventory` (
  `item_id` int unsigned NOT NULL,
  `link_id` int unsigned NOT NULL,
  PRIMARY KEY (`item_id`,`link_id`),
  KEY `fk_items2items_items_id` (`item_id`),
  KEY `fk_items2items_items_id2` (`link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory2experiments` (
  `item_id` int unsigned NOT NULL,
  `link_id` int unsigned NOT NULL,
  PRIMARY KEY (`item_id`,`link_id`),
  KEY `fk_items2experiments_item_id` (`item_id`),
  KEY `fk_items2experiments_link_id` (`link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `experiments2inventory` (
  `item_id` int unsigned NOT NULL,
  `link_id` int unsigned NOT NULL,
  PRIMARY KEY (`item_id`,`link_id`),
  KEY `fk_experiments2items_experiments_id` (`item_id`),
  KEY `fk_experiments2items_items_id` (`link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `compounds2inventory` (
  `compound_id` int unsigned NOT NULL,
  `entity_id` int unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`compound_id`,`entity_id`),
  KEY `fk_c2i_entity_id_items_id` (`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `containers2inventory` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `storage_id` int unsigned NOT NULL,
  `item_id` int unsigned NOT NULL,
  `qty_stored` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `qty_unit` varchar(10) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_steps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int unsigned NOT NULL,
  `body` text NOT NULL,
  `ordering` int unsigned DEFAULT NULL,
  `finished` tinyint unsigned NOT NULL DEFAULT '0',
  `finished_time` datetime DEFAULT NULL,
  `deadline` datetime DEFAULT NULL,
  `deadline_notif` tinyint unsigned NOT NULL DEFAULT '0',
  `is_immutable` tinyint unsigned NOT NULL DEFAULT '0',
  `reagent` varchar(255) DEFAULT NULL,
  `quantity` varchar(64) DEFAULT NULL,
  `duration_minutes` smallint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_items_steps_items_id` (`item_id`),
  KEY `idx_items_steps_next` (`item_id`,`finished`,`ordering`,`id`),
  KEY `idx_items_steps_open_deadline_item` (`finished`,`deadline`,`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS `inventory_request_actions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `requester_userid` int unsigned NOT NULL,
  `target_userid` int unsigned NOT NULL,
  `entity_id` int unsigned NOT NULL,
  `action` int unsigned NOT NULL,
  `state` tinyint unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `fk_items_request_actions_items_id` (`entity_id`),
  KEY `fk_items_request_actions_requester_users_userid` (`requester_userid`),
  KEY `fk_items_request_actions_target_users_userid` (`target_userid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
