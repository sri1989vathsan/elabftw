-- Fork migration 049: link an experiment/resource (or their templates) to
-- an Order, so a request in the Orders board can be traced back to what
-- it was for -- see EntityOrderLinks.php. One polymorphic table
-- (entity_type/entity_id/order_id) rather than one table per entity-type
-- pair, the same shape as todolist_entity_links (migration 031).
CREATE TABLE IF NOT EXISTS entity_order_links (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type VARCHAR(30) NOT NULL,
    entity_id INT UNSIGNED NOT NULL,
    order_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_entity_order (entity_type, entity_id, order_id),
    KEY idx_entity_order_links_order (order_id),
    CONSTRAINT fk_entity_order_links_order FOREIGN KEY (order_id) REFERENCES custom_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
