-- Fork migration 098: which items of a procurement were collected, as recognised on the signed collection sheets
-- (one row per basket item of the procurement confirmation, see Models/OrderSheets.php).
CREATE TABLE IF NOT EXISTS custom_order_sheet_items (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team INT UNSIGNED NOT NULL,
    procurement_id VARCHAR(50) NOT NULL,
    item_index SMALLINT UNSIGNED NOT NULL,
    article VARCHAR(100) NULL,
    sheet_name VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_custom_order_sheet_item (team, procurement_id, item_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
