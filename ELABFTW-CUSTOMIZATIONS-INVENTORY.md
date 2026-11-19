# eLabFTW customizations: inventory branch only

Notes that apply to the inventory branch only. The shared notes are in `ELABFTW-CUSTOMIZATIONS.md`, which is identical on the orders and inventory branches; add text here, not there, when it is only true for inventory. This file exists only on the inventory branch.

## What's new

- `src/whats-new-inventory.json` — the entries that exist only on the inventory branch, same format as `src/whats-new.json`. `src/whats-new.json` holds only the shared entries and is identical on both branches, so merges and cherry-picks never conflict in it. `WhatsNewStore` merges the two (newest first, an id in both is taken from `src/whats-new.json`, a missing or broken file is ignored).
- `src/whats-new-source.txt` — the default for `ELABFTW_WHATS_NEW` on this branch: `both` (shared + inventory-only entries), `orders` (shared only) or `inventory` (the inventory-only file alone).
- `tests/manual/whats-new-inventory-check.php` — checks that the old inventory guide's ids are all still present.
