-- Fork migration inv_002 (database branch only): storage_units.capacity (how many places fit in a storage place, added by 132) becomes
-- storage_units.moor_capacity, so that upstream's own storage_units.capacity (INT, a limit of containers) can be merged in without a clash.
-- Three states, one DDL change per run:
--  a) 132 ran: `capacity` is the fork's SMALLINT and there is no moor_capacity -> RENAME COLUMN (type, default and data are kept)
--  b) `capacity` is upstream's INT (fresh install after a merge) or absent, no moor_capacity -> `capacity` is not touched, moor_capacity is created
--  c) moor_capacity exists (re-run) -> nothing
-- Exactly one of the two statements below can do something; the second looks again after the first.
SET @custom_has_new = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'moor_capacity');
SET @custom_has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'capacity' AND DATA_TYPE = 'smallint');
SET @custom_sql = IF(@custom_has_new = 0 AND @custom_has_old = 1, 'ALTER TABLE `storage_units` RENAME COLUMN `capacity` TO `moor_capacity`', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
SET @custom_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'storage_units' AND COLUMN_NAME = 'moor_capacity');
SET @custom_sql = IF(@custom_exists = 0, 'ALTER TABLE `storage_units` ADD COLUMN `moor_capacity` SMALLINT UNSIGNED NULL DEFAULT NULL', 'SELECT 1');
PREPARE custom_stmt FROM @custom_sql;
EXECUTE custom_stmt;
DEALLOCATE PREPARE custom_stmt;
