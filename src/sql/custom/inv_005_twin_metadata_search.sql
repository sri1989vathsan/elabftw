-- Fork migration inv_005 (database branch only): inventory.metadata_search mirrors items.metadata_search (upstream migration
-- index-custom-field-values): the stored text of the custom fields, and the full-text index idx_items_q that includes it. Same expression as
-- upstream's. One ALTER, like upstream's: the index is rebuilt together with the column.
-- Guarded: nothing happens when the column is there (an install that has it already, or a re-run).
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory' AND COLUMN_NAME = 'metadata_search');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `inventory` ADD COLUMN `metadata_search` LONGTEXT GENERATED ALWAYS AS (COALESCE(JSON_UNQUOTE(CONCAT(CHAR(34), REPLACE(REPLACE(REPLACE(JSON_EXTRACT(`metadata`, ''$.extra_fields.*.value''), CHAR(92, 92), '' ''), CHAR(92, 34), '' ''), CHAR(34), '' ''), CHAR(34))), '''')) STORED, DROP INDEX `idx_items_q`, ADD FULLTEXT INDEX `idx_items_q` (`title`, `body`, `elabid`, `metadata_search`)', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
