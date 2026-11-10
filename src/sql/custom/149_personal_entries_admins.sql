-- Fork migration 149: the entries of personal modules are visible and editable by their owner and the admins (they were owner only).
UPDATE `inventory` AS i JOIN `inventory_categories` AS c ON c.id = i.category SET i.canread_base = 20, i.canwrite_base = 20 WHERE c.owner IS NOT NULL;
