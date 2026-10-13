-- Fork migration 087: a personal Reference ('my_reference') is no longer held in the pinned
-- section at the top; only 'Pinned for all' is. Existing references are unpinned once.
UPDATE custom_orders SET pinned = 0 WHERE status = 'my_reference';
