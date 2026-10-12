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

## 6. Acceptance checks before anything goes to the server

These ten come from the owner's list. Each is checked **in the inline grid and in the popup**
unless it says otherwise, in both browsers, and each should be repeated on a big table and on a page
with many tables. Nothing is deployed until every row is `PASS` in both browsers.

| # | What to check | Inline | Popup | Browser | Status | Last checked | Notes |
|---|---------------|:------:|:-----:|---------|--------|--------------|-------|
| A1 | The inline grid and the popup show the same data, cell for cell | yes | yes | both | WATCH | 2026-10-12 | Passed twice on a fresh table; once the popup showed raw formula text instead of the result and could not be reproduced |
| A2 | Inline: pressing Enter updates the table at once. Popup: the table only changes on **Update** | yes | yes | both | PASS | 2026-10-12 | Chromium; confirm in Firefox |
| A3 | The table is kept whether the changes are kept or not (Cancel, Escape, closing) | yes | yes | both | PASS | 2026-10-12 | Chromium; confirm in Firefox |
| A4 | The spacing around a table does not change (no blank blocks added or removed) | yes | yes | both | PASS | 2026-10-12 | Blocks identical after edit, apply, cancel and 4 saves (Chromium) |
| A5 | Formulas work in both (typing, results, references updating) | yes | yes | both | TODO | | |
| A6 | Undo and redo work in both, as before | yes | yes | both | PASS | 2026-10-12 | Chromium; confirm in Firefox |
| A7 | Adding and deleting rows and columns works in both | yes | yes | both | PASS | 2026-10-12 | Chromium with real clicks, menu and toolbar buttons |
| A8 | The spreadsheet's look does not change when rows or columns are added or deleted | yes | yes | both | PASS | 2026-10-12 | Chromium, real clicks. Found and fixed: new cells were left-aligned next to centred ones; now they copy the neighbour's alignment (inline and popup) |
| A9 | The formatting buttons work in both (bold, italic, colours, alignment, font size) | yes | yes | both | FAIL | 2026-10-12 | Inline passes. Popup: bold and italic show in the popup but were not kept after Update (script run); a real-click attempt did not apply bold at all. Being compared against the previous version |
| A10 | The table does not jiggle when scrolling | yes | n/a | both | WATCH | 2026-10-11 | Measured in Chromium only; confirm in Firefox |

### Speed (must not get slower, even with many or big tables)

Measured in Chromium with the app running locally. "Check" is the pre-save sync check added on
2026-10-12. Add a row when a new scenario is measured.

| # | Scenario | Content read (ms) | Check (ms) | Status | Notes |
|---|----------|------------------:|-----------:|--------|-------|
| P1 | 5 tables, none live | 8.1 | 0.01 | PASS | |
| P2 | 30 tables, 9 live grids | 30.4 | 6.8 | WATCH | About 0.8 ms per live grid; the content read itself grows with the number of tables |
| P3 | One table of 300 x 30 cells | | | TODO | Insert, live mount, content read, check, hashing both copies |
| P7 | Checks on versus off, 25 extra tables, 5 rounds | 23.0 vs 21.7 | 0.2 per call | PASS | Commit 562 vs 570 ms, popup open 23.3 vs 23.8 ms, popup apply 11.5 vs 11.5 ms, frames identical (16.7 ms) |
| P8 | Memory over 24 popup-open/cancel/scroll cycles | | | PASS | Heap flat (85 to 86 MB), element count constant (4,278), 0 leftover menus. Before the fix: 155 leftover menus |
| P9 | Page load, 5 tables | | | PASS | 1.1 s DOMContentLoaded, 1.7 s load, 86 MB, checks used 0 ms |
| P4 | Typing into a big table, one cell at a time | | | TODO | Time from Enter to the write reaching the table |
| P5 | Scrolling past 30 tables | | | TODO | Frame time before and after |
| P6 | Mounting a table (first click) before and after the sync checks | | | TODO | Needs a build of the earlier version for a true comparison |

## 7. Earlier fixes to re-check (regression list, suggested 2026-10-12)

Things fixed in earlier sessions. Today's work touched how tables are positioned, saved, focused and
undone, so these could break without anyone noticing. Delete any row you do not want.

**Most likely to be affected by today's changes**

| # | What to check | Browser | Status | Last checked | Why it is on the list |
|---|---------------|---------|--------|--------------|-----------------------|
| R1 | Tables far from the screen show a light preview; the first click makes one live and selects the clicked cell; the preview looks like the live grid (widths, heights) | both | TODO | | Tables are now positioned in page coordinates |
| R2 | The horizontal scroll bar never covers the last row of a live table | both | TODO | | Same positioning code |
| R3 | Double-click a cell and type: nothing is lost (the 2026-10-02 data-loss fix) | both | TODO | | Focus handling around cell editing changed |
| R4 | Cell formatting (bold, colours, alignment) set in the popup survives Update, save and reload | both | TODO | | Save path now has extra checks |
| R5 | Fill handle (drag a cell's corner) copies formulas correctly, including `$` references (2026-10-02 fix) | both | TODO | | |
| R6 | Ctrl+Z in the main text does not undo spreadsheet edits, and the table's own undo does not touch the text | both | TODO | | Writes to the table go through new wrappers |
| R7 | An autosave while you are typing in a cell does not interrupt the typing | both | TODO | | The pre-save check runs on every content read |
| R8 | Delete a spreadsheet with the trash icon, then undo: it comes back with its content | both | TODO | | Table and layout spacers are removed and restored |
| R9 | Copy and paste a range inside a table, between two tables, and from Excel; pasted PDF tables are cleaned up | both | TODO | | |
| R10 | Drag a column or row border to resize (with the size guide); autofit rows and columns; sizes survive save and reload | both | TODO | | |
| R11 | Double-click a table's cell edits in place and does not open the popup unexpectedly | both | TODO | | Popup open logic changed |
| R12 | Autosave and manual save work on a page that has many tables and large tables | both | TODO | | See the speed section |

**Other earlier fixes**

| # | What to check | Browser | Status | Last checked | Notes |
|---|---------------|---------|--------|--------------|-------|
| R13 | Spreadsheet caption and the inline "Edit title" button; the table of contents lists spreadsheets under their title, with show/hide switches for spreadsheets and pictures | both | TODO | | |
| R14 | Insert a spreadsheet of any size from the grid picker, "Custom spreadsheet", the Benchling-style data table and a well plate | both | TODO | | |
| R15 | The view page shows spreadsheets read-only, loads them lazily, and "copy table" works | both | TODO | | |
| R16 | Print and PDF export include the spreadsheet values (formula results, not formulas) | both | TODO | | |
| R17 | Tab and Shift+Tab indent several selected list lines at once | both | TODO | | |
| R18 | Picture captions show on top, in the editor and in the view; captioned pictures can be resized | both | TODO | | |
| R19 | Goals, Notes and Conclusion changes appear in the changelog | both | TODO | | |
| R20 | Template version history: open, compare, restore an older version, the others kept | both | TODO | | |
| R21 | Boards dialogs open centred beside an open sidebar; the file list is shown once and without the horizontal action buttons | both | TODO | | |
| R22 | Revisions: the number kept and the minimum days between them behave as before; timestamping an experiment still works | both | TODO | | Unchanged by today's work, listed so it is not forgotten |
| R23 | Sysadmin can edit Key features entries and upload a picture; other users cannot | both | TODO | | |

## 8. Right-click menu (inline grid and popup)

Added at the owner's request. These need a real right-click: scripted clicks cannot drive the menu.

| # | What to check | Inline | Popup | Browser | Status | Last checked | Notes |
|---|---------------|:------:|:-----:|---------|--------|--------------|-------|
| M1 | Right-click a cell: the menu opens next to the pointer, not far away | yes | yes | both | PASS | 2026-10-12 | Chromium: menu corner exactly at the pointer |
| M2 | Cell menu: Insert a new row before / after, Delete selected rows | yes | yes | both | PASS | 2026-10-12 | Chromium, real clicks: rows 5 to 6 to 5 in both |
| M3 | Right-click a column header: Insert a new column before / after, Delete selected columns | yes | yes | both | PASS | 2026-10-12 | Chromium, real clicks: columns 4 to 5 to 4 in both |
| M4 | Right-click a **row number**, including on a row whose height was changed: insert and delete work | yes | yes | both | FIXED? | | Fix pushed; confirm in Firefox |
| M5 | The menu closes on a click elsewhere and on Escape, and no second menu stays open | yes | yes | both | TODO | | |
| M6 | A table near the bottom of the screen: the menu flips upward and stays fully visible | yes | yes | both | TODO | | |
| M7 | After inserting or deleting through the menu, the grid and the saved table agree, and the look is unchanged (alignment, widths) | yes | yes | both | PASS | 2026-10-12 | Chromium; grid and table matched after a row and a column insert |
| M8 | Copy... , Paste... and Save as... items in the menu behave | yes | yes | both | TODO | | |
| M9 | Add comments item (cell menu) works or is hidden by choice | yes | yes | both | TODO | | |
| M10 | Menus are cleaned up: after scrolling past tables many times, no leftover menu elements stay in the page | yes | n/a | both | PASS | 2026-10-12 | 155 leftovers found, fixed in build 53; leak test now shows 0 and a constant element count |
| M11 | A table opened from a page with several tables: the menu belongs to the table that was clicked | yes | n/a | both | TODO | | |
| M12 | Right-click while a cell is being edited does not lose the typed text | yes | yes | both | TODO | | |

---

## Open items that are not tests

- Demo experiment "Demo: cell culture growth check" contains leftover test edits (one inline cell, A3 and A6 in the first table, one extra spreadsheet).
- Test favourites in the account: category "In vitro", owner "User 1 User 1", status "Success".
