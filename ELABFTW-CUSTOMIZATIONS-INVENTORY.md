# eLabFTW customizations: inventory branch only

Notes that apply to the inventory branch only. The shared notes are in `ELABFTW-CUSTOMIZATIONS.md`, which is identical on the orders and inventory branches; add text here, not there, when it is only true for inventory. This file exists only on the inventory branch.

## What's new

- `src/whats-new-inventory.json` — the entries that exist only on the inventory branch, same format as `src/whats-new.json`. `src/whats-new.json` holds only the shared entries and is identical on both branches, so merges and cherry-picks never conflict in it. `WhatsNewStore` merges the two (newest first, an id in both is taken from `src/whats-new.json`, a missing or broken file is ignored).
- `src/whats-new-source.txt` — the default for `ELABFTW_WHATS_NEW` on this branch: `both` (shared + inventory-only entries), `orders` (shared only) or `inventory` (the inventory-only file alone).
- `tests/manual/whats-new-inventory-check.php` — checks that the old inventory guide's ids are all still present.

## Twin tables (inventory, inventory_steps, ...): never `LIKE` an upstream table, mirror explicitly

The Database keeps a twin of each resource table: `inventory` (of `items`), `inventory_categories`, `inventory_steps`, `containers2inventory`, and so on (15 tables, listed in `tests/manual/inventory-twin-tables-check.sh`).

- **Rule: a migration never says `CREATE TABLE ... LIKE <upstream table>` (nor `INSERT ... SELECT` from one to build a table).** `LIKE` needs the source to exist (upstream dropped `items_revisions`, so `110_inventory.sql` fails on a fresh install of merged code and the runner would stop there for the whole list) and it takes a snapshot of whatever columns the source has that day, so an upgraded database and a fresh one end with different twins. Spell the columns out.
- **110 and 111 are never edited** (they are checksummed and already applied). `InventoryMigrations::REPLACED_WHEN_TABLE_MISSING` names the table each needs (`items_revisions`); where it is missing, `CustomMigrationRunner` records the file in the ledger as applied without running it, and `inv_003_twin_tables.sql`, listed right after 111, creates the same tables with explicit columns (`CREATE TABLE IF NOT EXISTS`, so it does nothing where 110 ran). Where the table exists, 110 and 111 run as they always did.
- **Columns upstream adds to a resource table later are mirrored by one guarded `inv_NNN_twin_<what>.sql` per change**, at the end of the list (`inv_004` requires_booking_approval, `inv_005` metadata_search + idx_items_q, `inv_006` color_fg, `inv_007` steps created_at, `inv_008` steps group_id). They keep upstream's name, type and default (the twin stays parallel to the resource table, and generic upstream code that names `{entity}_steps` keeps working); `moor_` is only for columns that mirror nothing of upstream's. Columns are appended (no `AFTER`), so the column order of a fresh and of an upgraded database is the same, not upstream's. No foreign keys, as with `LIKE`.
- When a merge brings a new column on a resource table, check with `tests/manual/inventory-twin-tables-check.sh` (needs Docker; builds an upgraded and a fresh database on a throwaway MySQL with the real runner, and compares every twin table): it fails until the mirror file exists.
- Not mirrored yet (upstream tables new since the merge-base with no twin; add them when the code of the Database needs them): `items_body_revisions` (replaces `items_revisions`; `inventory_revisions` keeps the old layout), `items_booking_approvers`, `items_step_groups`, `reactions2items`.
