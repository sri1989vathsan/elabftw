-- Fork migration 121: every module of the database has a Link field (a web address: the page of the product, the vendor, the protocol),
-- in the fields a new entry starts with and in the entries that exist already
UPDATE `inventory_categories`
SET `fields` = JSON_OBJECT('extra_fields', JSON_OBJECT('Link', JSON_OBJECT('type', 'url', 'value', '', 'position', 100)))
WHERE `fields` IS NULL;
UPDATE `inventory_categories`
SET `fields` = JSON_SET(`fields`, '$.extra_fields.Link', JSON_OBJECT('type', 'url', 'value', '', 'position', 100))
WHERE `fields` IS NOT NULL
    AND JSON_CONTAINS_PATH(`fields`, 'one', '$.extra_fields.Link') = 0;
UPDATE `inventory`
SET `metadata` = JSON_SET(`metadata`, '$.extra_fields.Link', JSON_OBJECT('type', 'url', 'value', '', 'position', 100))
WHERE `category` IS NOT NULL
    AND `metadata` IS NOT NULL
    AND JSON_VALID(`metadata`)
    AND JSON_CONTAINS_PATH(`metadata`, 'one', '$.extra_fields') = 1
    AND JSON_CONTAINS_PATH(`metadata`, 'one', '$.extra_fields.Link') = 0;
