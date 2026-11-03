-- Fork migration 130: the Antibodies module has no yes/no field "Conjugated": the field Conjugate (the dye or label) says it. The field is taken
-- out of the module and of the antibodies that have it
UPDATE `inventory` SET `metadata` = JSON_REMOVE(`metadata`, '$.extra_fields.Conjugated')
    WHERE `category` IN (SELECT `id` FROM (SELECT `id` FROM `inventory_categories` WHERE `title` = 'Antibodies') AS antibodies)
        AND `metadata` IS NOT NULL AND JSON_VALID(`metadata`) AND JSON_CONTAINS_PATH(`metadata`, 'one', '$.extra_fields.Conjugated') = 1;
UPDATE `inventory_categories` SET `fields` = JSON_REMOVE(`fields`, '$.extra_fields.Conjugated')
    WHERE `title` = 'Antibodies' AND `fields` IS NOT NULL AND JSON_CONTAINS_PATH(`fields`, 'one', '$.extra_fields.Conjugated') = 1;
