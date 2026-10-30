-- Fork migration 110: the Inventory, a type of its own next to the resources. Every table is a twin of its resource table
-- (same columns and indexes, no data) so the inventory never touches the resources. LIKE copies the columns the custom
-- migrations added to the resource tables too, as long as this one runs after them.
CREATE TABLE IF NOT EXISTS inventory LIKE items;
CREATE TABLE IF NOT EXISTS inventory_categories LIKE items_categories;
CREATE TABLE IF NOT EXISTS inventory_status LIKE items_status;
CREATE TABLE IF NOT EXISTS inventory_changelog LIKE items_changelog;
CREATE TABLE IF NOT EXISTS inventory_comments LIKE items_comments;
CREATE TABLE IF NOT EXISTS inventory_revisions LIKE items_revisions;
CREATE TABLE IF NOT EXISTS inventory_edit_mode LIKE items_edit_mode;
CREATE TABLE IF NOT EXISTS pin_inventory2users LIKE pin_items2users;
CREATE TABLE IF NOT EXISTS inventory2inventory LIKE items2items;
CREATE TABLE IF NOT EXISTS inventory2experiments LIKE items2experiments;
CREATE TABLE IF NOT EXISTS experiments2inventory LIKE experiments2items;
CREATE TABLE IF NOT EXISTS compounds2inventory LIKE compounds2items;
CREATE TABLE IF NOT EXISTS containers2inventory LIKE containers2items;
