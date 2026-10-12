# Manual and automated test checklist

A living list. Add a row whenever something should be tested again, and update **Status** and
**Last checked** when you test it. Nothing here is a promise that it works: it records what was
last seen, by whom, and in which browser.

**How to add something:** copy a row, give it the next number in its section, describe the steps
in one line, and set the status to `TODO`. Say which browser matters if it is not "both".

**Status values:** `PASS` seen working · `FAIL` seen broken · `WATCH` works but keep an eye on it ·
`FIXED?` a fix exists but was not confirmed by the person who reported it · `TODO` never tested ·
`N/A` not applicable.

**Browsers:** `FF` Firefox, `CH` Chromium/Chrome. Use a **private window** (or Cmd+Shift+R) so an
old cached script is not tested by accident.

---

## 1. Spreadsheet: inline grid, popup and saved table staying in sync

Automated: `tests/manual/spreadsheet-sync-stress.js` (see the top of that file for how to run it).
It uses a scratch table, so no real data is touched. Add new random operations there when a new
kind of failure shows up.

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| S1 | Inline edits at varied delays (0 ms to 1.5 s) keep every cell, including formulas | CH | PASS | 2026-10-12 | 60-round seeded run; only the table's normal 500 ms lag showed (test fixed) |
| S2 | Popup **Update** applies the edited cells to the table and the grid | CH | PASS | 2026-10-12 | 6 of 6 applied after the fix of build 48 |
| S3 | Popup **Cancel** leaves the table and the grid unchanged | CH | PASS | 2026-10-12 | |
| S4 | Scroll the table away and back, then edit: nothing lost | CH | PASS | 2026-10-12 | |
| S5 | Edit then save/read content **immediately** (inside the 500 ms delay): the saved text has the edit | CH | TODO | | Added to the stress test, not yet run |
| S6 | Save, reload the page: every cell matches what was typed | CH | PASS | 2026-10-12 | First scratch table, 20 of 20 cells |
| S7 | Fault: change the table behind the grid's back, then verify: detected, grid reloaded, recovery copy kept | CH | PASS | 2026-10-12 | Recovery copy now holds the discarded grid (build 49), not yet re-checked |
| S8 | Fault: conflict (grid edited and the table changed) | CH | TODO | | |
| S9 | Fault: an older grid writes over a newer table (stale overlay write) | CH | TODO | | |
| S10 | Fault: popup applied after the table changed while it was open | CH | TODO | | |
| S11 | Recovery copies can be restored (`elabftwSpreadsheetDiagnostics.restoreRecovery(i)`) | CH | TODO | | |
| S12 | Same stress run in Firefox | FF | TODO | | Run the script in the Firefox console |
| S13 | The checks never block a save or Update, even if they throw | both | TODO | | Fault-inject an error inside a check |

## 2. Spreadsheet: editing behaviour

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| E1 | Insert a spreadsheet, type straight away: text goes into the cell and does not stop at the column width | both | WATCH | 2026-10-11 | Worked for you; the fix covers the code-selected first cell only |
| E2 | Popup: one click on a cell, then type: text goes into that cell (not the page text) | both | PASS | 2026-10-12 | Firefox confirmed by you; Chromium checked by me |
| E3 | While the popup is open, typing never reaches the page text behind it | both | PASS | 2026-10-09 | Page behind is inert and ignores input |
| E4 | Popup Cancel after editing a cell and confirming does not delete the table | FF | PASS | 2026-10-09 | |
| E5 | Inline: click a cell after the caret was in the page text, then type: text goes into the cell | CH | PASS | 2026-10-11 | |
| E6 | Escape in a cell editor restores the original value (inline and popup) | CH | PASS | 2026-10-11 | Popup Escape keeps the popup open |
| E7 | Right-click a row number, Insert row above / below, on a row whose height was changed | both | FIXED? | | Wrapper now ignores clicks |
| E8 | Inserted rows and columns look like the rest of the table | both | WATCH | 2026-10-11 | Rows look right for you; columns not reported. Rows below keep old stripe shading |
| E9 | Right-click a cell, insert column before/after | both | PASS | | Worked for you throughout |
| E10 | Tables do not wiggle or lag when scrolling up and down | both | PASS | 2026-10-11 | Measured in Chromium (layers move with the page). Please confirm in Firefox |
| E11 | Blank lines under a table: the reserved-space block cannot be deleted, an empty paragraph can | both | PASS | 2026-10-11 | Accepted as is |

## 3. Search panel, filters and favourites

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| F1 | Apply filters changes the results | both | PASS | | Fine for you. With Type = All the checkboxes only narrow once a type is picked |
| F2 | Favourite categories and statuses show under Type = All; ticking one switches Type | both | PASS | 2026-10-09 | |
| F3 | Favourite tags show in the filters | both | PASS | | Fine for you |
| F4 | "Create and favourite" a category works under Type = All and under a template type | both | PASS | | |
| F5 | Sidebar results: Link and Add to text are icon-only with hover text | both | PASS | | |

## 4. Key features page

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| K1 | Page and menu are called "Key features"; only featured entries show | both | PASS | 2026-10-11 | 7 featured entries |
| K2 | Area chips filter the entries without reloading | CH | PASS | 2026-10-11 | |
| K3 | "See all updates" lists every entry and marks the featured ones; "Back to key features" returns | CH | PASS | 2026-10-11 | |
| K4 | A sysadmin can tick "Show in Key features" on an entry and save | both | TODO | | Only the form was checked, no save |
| K5 | Pictures added to the three new entries | both | TODO | | Waiting for screenshots |
| K6 | Wording of the three new entries is accurate | n/a | TODO | | Written from the code, not from using the features |

## 5. Build, cache and deployment

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| B1 | After a rebuild, the script address changes (`?v=...-<build time>`) so no hard reload is needed | both | PASS | 2026-10-11 | Confirmed in the page source; Firefox behaviour not yet confirmed |
| B2 | Nightly workflow publishes the image to ghcr.io | n/a | TODO | | Test run started, result not checked |
| B3 | Editable top-bar links (LabCollector, OpenIRIS, MoorLab Wiki, ETHIS, MoorLab Zoom) open and can be edited by a team admin | both | TODO | | |

---

## Open items that are not tests

- Demo experiment "Demo: cell culture growth check" contains leftover test edits (one inline cell, A3 and A6 in the first table, one extra spreadsheet).
- Test favourites in the account: category "In vitro", owner "User 1 User 1", status "Success".
