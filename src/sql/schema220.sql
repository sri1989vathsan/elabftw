-- schema 220
-- planned entries of the database: made on paper, not ordered or built yet. They are private to their owner, kept out of the
-- lists of the database and have no number of their own until they are marked ready
ALTER TABLE `inventory`
    ADD COLUMN `is_planned` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
    ADD INDEX `idx_inventory_planned` (`is_planned`, `userid`);
-- every module counts on its own: the entries that have no number yet get one, in the order they were made, after the highest
-- number of their module (the planned ones have none until they are marked ready)
UPDATE `inventory` AS i
JOIN (
    SELECT x.id, COALESCE(m.highest, 0) + ROW_NUMBER() OVER (PARTITION BY x.category ORDER BY x.id) AS number
    FROM `inventory` AS x
    LEFT JOIN (SELECT category, MAX(custom_id) AS highest FROM `inventory` WHERE custom_id IS NOT NULL GROUP BY category) AS m
        ON m.category = x.category
    WHERE x.custom_id IS NULL AND x.category IS NOT NULL AND x.is_planned = 0
) AS r ON r.id = i.id
SET i.custom_id = r.number;
