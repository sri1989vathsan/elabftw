-- Fork migration 120: antibodies and reagents are ordered from their entry; a product link field is added to the fields a new entry of
-- these modules starts with (the vendor, the clone and the catalog number are there already)
UPDATE `inventory_categories`
SET `fields` = JSON_SET(`fields`, '$.extra_fields.Link', JSON_OBJECT('type', 'url', 'value', '', 'position', 20))
WHERE `title` IN ('Antibodies', 'Reagents')
    AND `fields` IS NOT NULL
    AND JSON_CONTAINS_PATH(`fields`, 'one', '$.extra_fields.Link') = 0;
