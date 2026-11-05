-- Fork migration 138: low stock is a rule of each module of the database (settings.track_low_stock); it makes no sense for plasmids
UPDATE `inventory_categories` SET `settings` = JSON_SET(COALESCE(NULLIF(`settings`, ''), '{}'), '$.track_low_stock', false) WHERE `title` = 'Plasmids' AND JSON_EXTRACT(COALESCE(NULLIF(`settings`, ''), '{}'), '$.track_low_stock') IS NULL;
