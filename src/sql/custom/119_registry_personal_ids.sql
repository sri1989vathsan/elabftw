-- Fork migration 119: every entry of the database has two numbers. custom_id is the number of the lab (given when the entry is
-- registered in the Database, one count per module); personal_id is the number of its owner (given when it is made, one count per
-- owner and module, from 1), given when the owner registers the entry for themselves. An entry without either number is not registered.
ALTER TABLE `inventory`
    ADD COLUMN `personal_id` INT UNSIGNED NULL DEFAULT NULL,
    ADD INDEX `idx_inventory_personal` (`userid`, `category`, `personal_id`);
UPDATE `inventory` AS i
JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY userid, category ORDER BY id) AS number
    FROM `inventory`
    WHERE category IS NOT NULL AND (custom_id IS NOT NULL OR is_planned = 0)
) AS r ON r.id = i.id
SET i.personal_id = r.number;
