-- Fork migration 099: the signed collection sheets recorded per procurement (one row per sheet), and the sheet each
-- collected item was found on (see Models/OrderSheets.php and the Order Status tab).
CREATE TABLE IF NOT EXISTS custom_order_sheets (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team INT UNSIGNED NOT NULL,
    procurement_id VARCHAR(50) NOT NULL,
    sheet_name VARCHAR(255) NOT NULL,
    filesize INT UNSIGNED NOT NULL DEFAULT 0,
    upload_id INT UNSIGNED NULL,
    items_found SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_custom_order_sheet (team, procurement_id, sheet_name, filesize)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @custom_needs_sheet_id = (
    SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_sheet_items' AND COLUMN_NAME = 'sheet_id'
);
SET @custom_sql = IF(@custom_needs_sheet_id = 1,
    'ALTER TABLE custom_order_sheet_items ADD COLUMN sheet_id INT UNSIGNED NULL AFTER item_index, DROP INDEX uniq_custom_order_sheet_item, ADD UNIQUE KEY uniq_custom_order_sheet_item (team, procurement_id, item_index, sheet_id)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
