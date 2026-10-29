-- Fork migration 103: primary and secondary storage. One container of a resource is its primary storage,
-- the others are secondary. Existing resources get their oldest container as primary.
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'containers2items' AND COLUMN_NAME = 'is_primary');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `containers2items` ADD COLUMN `is_primary` TINYINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;

-- only for the resources that have no primary yet, so running it again changes nothing
UPDATE `containers2items` AS c
    JOIN (SELECT item_id, MIN(id) AS first_id FROM `containers2items` GROUP BY item_id HAVING SUM(is_primary) = 0) AS f
        ON c.id = f.first_id
    SET c.is_primary = 1;
