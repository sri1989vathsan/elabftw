-- Fork migration 100: how many basket items the confirmation had the last time a sheet was matched against it, so a
-- sheet recorded before the item list was readable is looked at again once it is (see OrderSheets::rescan()).
SET @custom_needs_basket_seen = (
    SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_sheets' AND COLUMN_NAME = 'basket_seen'
);
SET @custom_sql = IF(@custom_needs_basket_seen = 1,
    'ALTER TABLE custom_order_sheets ADD COLUMN basket_seen SMALLINT UNSIGNED NULL AFTER items_found',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
