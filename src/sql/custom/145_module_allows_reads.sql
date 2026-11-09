-- Fork migration 145: a module says whether sequencing reads can be attached to its entries (the "Attach reads" button of the Database list is
-- only shown for such modules). The plasmid modules keep it; the others do not have it until it is ticked in the rules of the module.
UPDATE `inventory_categories` SET `settings` = JSON_SET(`settings`, '$.allows_reads', TRUE) WHERE `title` IN ('Plasmids', 'Plasmid') AND `settings` IS NOT NULL AND JSON_EXTRACT(`settings`, '$.allows_reads') IS NULL;
