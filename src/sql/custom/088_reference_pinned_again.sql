-- Fork migration 088: a personal Reference ('my_reference') is held in the pinned section again
-- (it is only ever visible to its author, so it is pinned for that person only). Migration 087
-- had unpinned them; pin them once more.
UPDATE custom_orders SET pinned = 1 WHERE status = 'my_reference';
