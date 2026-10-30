-- Fork migration 111: the steps and the request actions of the inventory, twins of the resource tables (see 110)
CREATE TABLE IF NOT EXISTS inventory_steps LIKE items_steps;
CREATE TABLE IF NOT EXISTS inventory_request_actions LIKE items_request_actions;
