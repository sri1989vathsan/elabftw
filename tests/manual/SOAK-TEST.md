# The soak test: what it checks and everything it has covered

The soak test (`tests/manual/spreadsheet-soak.js`, 2,179 lines) works the spreadsheet editor like a person does for a long
time, again and again, and looks for three things: **data lost**, **a layout or menu that breaks**, and **the editor getting
slower**. It is a script for the browser console; it is not run by `node --test`.

This file lists every check, every scenario and the history of what was added, so a new fault can be added in the right
place. Keep it current: when a change to the spreadsheet is made, add a scenario or a check to the script and a line here
(see "How to add to it", at the end).

Scope: the spreadsheet editor in an experiment (inline grid, popup, saved table). The Database features of this branch
(primers, orders, locking, the sequence editor) are not driven by the soak; what covers them is listed in section 9.

---

## 1. How to run it

Use a **scratch experiment** (a new empty one, in edit mode, logged in). The test adds and removes its own spreadsheets and
leaves what was on the page alone (the "date-then-header" scenario puts the page's own text back when it is done).

Keep the window fully visible and stay on the tab: a hidden tab stalls the run (see "INCONCLUSIVE" below). A full run takes about
25 to 30 minutes.

Chrome or Firefox, from the console (Firefox: type `allow pasting` and press Enter the first time):

```js
const report = await spreadsheetSoak({ seed: 1, sessions: 3 });
console.log(JSON.stringify(report, null, 2));
```

Firefox in one paste: `tests/manual/firefox-soak.js` (it contains the soak itself).

| Option | Meaning | Default |
|---|---|---|
| `seed` | start of the random choices (the same seed repeats the same run) | 1 |
| `sessions` | how many times the whole set of scenarios is repeated | 2 |
| `randomRounds` | steps in the `mixed` scenario | 30 |
| `scenarios` | names of the scenarios to run (a list) | all 27 |
| `settleMs` | wait after a step before reading | 900 |
| `quick` | shorter waits, at most 10 random rounds | off |
| `keepTables` | do not remove the scratch tables at the end | off |

Without waiting: `spreadsheetSoak({...})` then read `window.spreadsheetSoakProgress` (session, scenario, how many data losses and
failures so far) and `window.spreadsheetSoakLive` (the findings as they come) while it runs, and `window.spreadsheetSoakReport` when it
is done.

**After the run, reload the page** and run:

```js
const after = await spreadsheetSoakAfterReload();
```

It compares what was saved with the script's own record, then removes the scratch tables (only when everything agreed).
Only cell text that the script itself typed is ever held by it.

## 2. Reading the verdict

| Verdict | Meaning |
|---|---|
| `CLEAN` | no data lost, sizes and menus correct, nothing slowed down |
| `DATA LOSS FOUND` | a typed value is missing or different (the most important result) |
| `PROBLEMS FOUND (no data lost)` | a size, menu, scroll, anomaly or timing problem |
| `INCONCLUSIVE` | the page was hidden for more than 20% of the steps (screen asleep, window covered, tab in the background): the browser slows timers and redraws then, so size and speed checks mean little. Run it again with the window in front. |

The report also gives: `scrollJiggleEvents`, `editorSize` (checks, widest editor, most extra and most missing height, problems),
`menus` (how many checked, problems), `slowingDown` (the steps that got slower, per-step first/last third timings, heap growth, steps run
while hidden), `otherFailures`, `steps` (how many of each kind of step ran), `editorSyncEvents` (stale-overlay-write, sync-mismatch,
popup-write-mismatch, recovery-copy), and `samples` (one per step: time, memory, page size, leftover grids).

## 3. What is checked, and when

### 3.1 Data loss (most important)
- Every cell typed, or kept through an insert or delete of rows and columns, a popup Update, a copy and paste, a save, is
  compared with the script's own record, in the live grid **and** in the saved table, after every step (`verify`), and once more after
  the page is reloaded (`spreadsheetSoakAfterReload`).
- The record follows what rows and columns really did: it is changed only by what happened (read back from the table, waiting up to 5 s),
  then compared strictly.
- Empty trailing rows and columns are trimmed the same way as in the editor's diagnostics.
- A formula in the record matches its shown result; after a row or column change a formula's references may be rewritten (`=A1+1`
  becomes `=B1+1`), which is accepted, but a formula cell must never lose its formula and no other cell may change.
- A well plate is stored as a plate, not as a grid of text: after a reload it only has to come back.

### 3.2 Anomalies (cells and text)
- Cells are compared exactly (`exactCellCheck`): a stray space, a non-breaking space or a hidden character that was not typed is a fault.
- The text outside the spreadsheets must change only when the test changes it (`outsideSignature`); nothing may appear around a table on
  its own: an empty line, a spacer, a non-breaking space; spacers must not pile up; a table must not vanish.
- Consistency of the three copies (`consistency`): inline grid, popup and the stored HTML agree cell for cell.

### 3.3 Editor size and layout (`measure`, `layoutCheck`)
- After every step the editor's width and height are measured: the frame is not wider than the page and does not scroll sideways, grids
  stay inside it, the editor is not much taller than its content and does not cut it off (reported only when the frame's own document overflows).
- The editor must fit the table right after rows are added or removed.
- Nothing may cover or cut off the last row (the Add rows bar, a scroll bar).
- Rows added by the Add rows bar or the menu are as tall as the others (they were once 4 px shorter); row heights may differ by 3 px; the
  popup's Update must not save row heights it was not asked to.
- Every cell of the grid and of the stored table sits in the vertical middle (`verticalAlignCheck`).
- A well plate keeps its labels (1, 2, 3 across, A, B, C down) and its fixed size; no Add rows bar; Enter in the last row adds nothing (`plateCheck`).
- The "number of rows + Add rows" bar works (`addRowsBar`).
- The size and plate-label checks are skipped while the page is hidden (nothing is redrawn then) and the run says how much was hidden.

### 3.4 Right-click menus (`menuTour`, `menuCheck`, `closeMenu`)
- Right-click a cell, a row number and a column letter, at the top and at the bottom of the screen. The menu must be fully on screen, next to
  the pointer, on top of everything else, close again, and leave nothing behind.
- Menu items are pressed like a mouse (they act on mouse down and up; a bare `click()` does nothing).
- Insert and delete rows and columns go through the real menu (`structureOp`); several at once through click and shift-click (`multiDelete`).

### 3.5 Scrolling (`scrollCheck`)
- Scroll down and up in small steps. At every stop each grid must sit exactly on its table (no drift, 3 px allowed), the editor keeps its height,
  and tables keep their place in the text. The check waits for the editor to settle first and names the table that changes.

### 3.6 Slowing down (end of the run)
- Time of every kind of step, memory, page size and leftover grids are tracked across the sessions. For each step the median of the first third
  of its runs is compared with the last third; flagged when the last is more than 1.6 times the first and 60 ms slower (at least 9 runs).
- Memory: flagged when the heap grows by more than 50% and 40 MB.
- Menu elements left in the page may not be more than the number of grids plus 2.
- Steps that ran while the page was hidden are not counted.

## 4. The scenarios (27, each is a way of working)

Default order. The year is 2026; the date is when the scenario was added (from the history of the script).

| # | Name | Added | What it does | What it guards |
|---|---|---|---|---|
| 1 | `plate-day` | 15 Oct | inserts a 96-well plate; types 20 well values (fewer in quick); a popup edit and Update; menu tour; scroll check; save | data in a plate, the plate view skipping grid steps, popup Update, plate labels and size |
| 2 | `back-to-back` | 15 Oct | three spreadsheets inserted one after the other (4x4, 6x5, 8x3); three rounds of typing in each; menu tour of each; popup on the second | tables next to each other not leaking into one another, size of the editor with several grids |
| 3 | `spaced-out` | 15 Oct | four spreadsheets with text between them; typing top to bottom and back with page scrolls; row and column inserts and multi-deletes on each | tables keeping their place in the text, saved heights |
| 4 | `copy-paste` | 15 Oct | a table copied and pasted right after itself and further down; each copy edited alone | edits leaking between copies, the three-copy consistency |
| 5 | `wide-plate` | 15 Oct | a 384-well plate (wide): corners typed, menus, scroll | width of the editor, plate labels, a wide grid |
| 6 | `format-and-popup` | 15 Oct | click-and-type, formatting buttons (bold, italic, alignment) inline and in the popup, closing the popup four ways without saving | the look surviving the popup's Update and the stored table; closing the popup never deletes, empties or moves a table |
| 7 | `enter-last-row` | 15 Oct (updated 4 and 11 Nov) | Enter in the last row, typing then at once a row or column insert or delete, Enter followed by a popup | **data was lost here once**: values typed through the editor box exist only in the editor's own copy until a redraw. Enter never adds a row; a second Enter stays |
| 8 | `multi-delete` | 15 Oct | selects several rows or columns and deletes them at once, then a quick second delete before the table caught up | the grid, saved table and record agree after each delete; nothing comes back |
| 9 | `date-then-header` | 15 Oct | five situations on a clean page: (1) a date, then the next paragraph becomes Heading 2, (2) a date then the Insert title button and window, (3) text under a date made a heading, (4) a heading inserted straight after the date, (5) two dates with a header under each | reported by the owner: "an empty line is inserted" when a header is put under a date. The page's own text is put back at the end |
| 10 | `type-then-resize` | 24 Oct | header cells typed, the column width changed straight after (drag, or a double click for autofit), some rounds leave the editor of the last cell open | **reported data loss**: typed text replaced by older grid data |
| 11 | `enter-semantics` | 24 Oct (updated 4 Nov) | Enter commits and stays; a second Enter moves down; at the last row it stays | the Enter rules of the grid (since 27 October the first Enter already moves to the next cell) |
| 12 | `tab-then-type` | 24 Oct | after Tab or Shift+Enter, typing and Enter act on the cell the cursor is now on; typing on without touching the mouse | keyboard focus and the record of the selected cell after Enter, Tab and clicks on grey cells |
| 13 | `sink-text` | 24 Oct | text arriving in the grid's hidden input without key presses (input methods, dead keys, dictation): `µg/µL`, `Ratio:Primer`, `#oligos in panel`, `é à ü` | text that does not come from key events |
| 14 | `format-after-typing` | 24 Oct | a format button pressed while a cell is still being typed in; a different cell each round (Bold toggles) | the typed text kept when a format is applied |
| 15 | `filler-click` | 24 Oct | a click on a grey column beside the grid adds the columns up to it and typing there works | accepts a grid that already fills the width (no grey cell: not a fault); waits up to 4 s for the layout loop when the page is hidden |
| 16 | `autosave-in-grid` | 24 Oct | edits made inside a grid are saved without leaving it | autosave while typing |
| 17 | `popup-direct-typing` | 24 Oct | typing straight over cells in the popup: Enter stays (since 27 Oct moves down), a second Enter moves down, in the last row it stays; Update keeps everything | the popup's keyboard rules |
| 18 | `paste-external` | 24 Oct | a table pasted from another application: centred vertically whatever it came with, editable at once | a pasted table with the source's own tight style |
| 19 | `undo-redo` | 25 Oct | Ctrl+Z and Ctrl+Shift+Z on an inserted table and on a pasted one: 3 undos, 2 redos, a new edit after undoing (the rest of the redo list is gone), a redo with nothing to redo (changes nothing) | undo and redo of typed text |
| 20 | `undo-everything` | 11 Nov | every kind of change once in random order, then random ones: typing, bold, alignment, added rows, a dragged column width. A record is taken after each step; undo walks back through the records to the table as inserted, redo walks forward | undo and redo of every kind of change, not only text; a failure names its step sequence |
| 21 | `copy-table-format` | 25 Oct | the Copy table button and a selection copy through the copy event carry values and formatting | what the clipboard holds |
| 22 | `paste-range-format` | 12 Nov | a range copied in one grid and pasted in another brings its formatting (A1:B2 pasted at B2: the old bold cell C3 turns plain), one undo takes values and formatting back together, a copied formula moves its references with the paste (`=A3+1` from B3 becomes `=B4+1`) | the grid in the text pasted values only before; the clipboard is a plain object with getData and setData so it works in every browser |
| 23 | `default-border-apply` | 25 Oct | the table-wide default border (colour, style, width) and Apply appearance: every cell whose border is still the previous default follows, each time | it used to change only cells that had no border of their own |
| 24 | `colour-live` | 9 Nov | a colour picked in a swatch of the popup's format bar applies by itself after a short pause, no press of the button; only `input` is sent, as by a picker that is still open | the colour applying without the button |
| 25 | `drag-select` | 25 Oct | dragging over cells row by row: the selection follows, the fill handle lets go of the pointer meanwhile and comes back; the last cell is the far corner | selection by dragging |
| 26 | `formulas-and-structure` | 25 Oct | a 7x7 table with formulas (`=A1+1`, `=A1+B1`, `=SUM(A1:B1)`, `=A1*2`, `=A2*2`); 14 rounds of inserts, multi-deletes and typing | a formula cell never loses its formula; rewritten references accepted |
| 27 | `mixed` | 15 Oct (steps added 24 and 25 Oct) | three tables, then a random session (see below), 30 rounds | chaos: any order of steps |

## 5. The mixed session

Each round picks a table and one kind of step by weight (higher weight = more often), then waits a random time (0 to 700 ms), measures and
verifies (settled every 6th round):

| Weight | Step | |
|---|---|---|
| 22 | `type` | a number or a formula (20% `=A1+1`) in a random cell |
| 12 | `type-direct-enter` | typing straight over a selected cell, finished with Enter |
| 6 | `type-direct-tab` | finished with Tab |
| 10 | `type-then-resize` | typing, then a column width change (editor sometimes left open) |
| 5 | `type-then-bold` | typing, then Bold while the editor is open |
| 5 | `enter-again` | a second Enter on a selected cell |
| 5 | `sink-text` | text without key presses |
| 3 | `filler` | a click on a grey column |
| 3 | `add-rows-bar` | add one or two rows |
| 4 | `scroll` | the scroll check |
| 4 | `popup-apply` | the popup, 1 or 2 edits, Update |
| 3 | `popup-cancel` | the popup, one edit, cancelled |
| 3 | `multi-delete` | several rows or columns at once |
| 5 | `rows-columns` | one row or column inserted or deleted through the menu |
| 3 | `menu` | the menu tour |
| 4 | `save` | the save |

Then a final settled verification and the three-copy consistency check.

## 6. Helpers of the script (what a step is made of)

`createTable` (an inserted table, or a 96 or 384 plate), `typeInto` and `editCell` (double click, type, Tab), `typeDirect` (the first key a real keydown,
the rest into the editor box, finished with Enter, Tab or left open), `selectCell`, `enterAgain`, `resizeColumn` (drag or double click),
`sinkTextInto`, `fillerAdd`, `pasteExternal`, `pasteCopy`, `undoKey`, `boldCell`, `structureOp`, `multiDelete`, `popupEdit`, `popupClosing`,
`openPopupFor`, `formatting`, `clickToType`, `rowHeightsUniform`, `addRowsBar`, `plateCheck`, `scrollCheck`, `menuTour`, `save`, `addText`,
`dumpSavedHeights` (a diagnostic: the row heights saved in each table, kept on `window` for a later read).

## 7. History: what was added and why

From the history of the script (newest first, grouped).

**November**
- 12 Nov: `paste-range-format`: pasting a range keeps its formatting, undoes in one step and shifts formulas.
- 11 Nov: `undo-everything` added; a failure names its step sequence and the editor is let settle; a cut-off editor is reported only when the
  frame's own document overflows; the scroll check watches the editor settle and names the table that changes; the after-reload check no longer
  reads a plate as a grid; plate and popup-Enter checks brought up to date; per-row heights reported in growth checks, with a saved-height dump;
  "Enter must never add a row, a second Enter in the last row stays".
- 9 Nov: `colour-live`.
- 4 Nov: Enter while editing is expected to move to the next row, as since 27 October.

**Late October**
- 25 Oct: `undo-redo`, `copy-table-format`, `drag-select`, `formulas-and-structure`, `default-border-apply` (border colour on neighbouring edges) and the chaotic
  `mixed` session.
- 24 Oct: `tab-then-type`, `sink-text`, `format-after-typing` (a different cell each round), `filler-click` (a real double click presses first, a full-width grid is
  accepted), `autosave-in-grid`, `popup-direct-typing`, `paste-external`, multi-delete reports what it saw.
- 17 Oct: the plate label and grid position checks are skipped while the page is hidden, and the run says when much of it was hidden.

**Mid October**
- 16 Oct: ask for a table's grid several times before giving up (a busy machine stopped whole scenarios with a null grid); the editor size check is skipped while hidden;
  short text before the popup so a wrapped row is not reported as a row-height problem; a formula in the record matches its shown result in multi-delete (it was reported as
  data loss); well plate headers and fixed size are checked and a grid that does not come up is reported, not fatal; the editor must fit the table right after rows are
  added or removed; the popup's Update must not save row heights it was not asked to.
- 15 Oct: the soak is added (data loss, editor size, menus, slowdown). Then in the same day: trim blank rows like the diagnostics; a real right-click sequence; a page width
  baseline; multi-row/column delete, three-copy consistency and scroll jiggle (the record updates only when an action really happened); formatting buttons inline and popup,
  popup closing four ways, click-and-type; settle before measuring, the record follows what rows and columns really did, 3 px tolerance for scroll drift; each scenario starts on a
  clean page; live findings exposed while running; the wait for the grid to redraw after menu actions and for the stored table size (up to 5 s); cancel a click-to-type with Escape;
  Enter in the last row and typing then an immediate row/column change (the lost-values case); menu items pressed like a mouse; the header-under-a-date scenario; what was on the
  page is left alone and only its own spreadsheets counted; formula results on screen ignored; Add rows bar and equal row heights; nothing may cover or cut off the last row; look for
  stray spaces, blank lines or text changing around the spreadsheets and spacers piling up; click-then-type waits for the editor and records how long it takes to open; a scenario of
  repeated multi-row/column deletes checking the saved table after each; work out what a multi-delete removed from the real grid cells (not a trimmed view); leave steps run while the page
  was hidden out of the timing comparison; bring the grid live before reading it after a multi-delete; row heights may differ by 3 px.

## 8. The scripts that go with it

| Script | What it does |
|---|---|
| `firefox-soak.js` | the soak in one paste for Firefox |
| `spreadsheet-sync-stress.js` | stress of the inline grid, popup and saved table synchronisation: `spreadsheetSyncStress({ seed, rounds })` |
| `spreadsheet-faults.js` | deliberate faults (checklist S7 to S11): each makes grid, popup and saved table disagree and checks that the editor notices, keeps a recovery copy of the replaced version, and ends in agreement |
| `spreadsheet-regression.js` | regression checks of earlier fixes (checklist section 7, R6 and on: main-text undo does not touch table edits, an autosave while typing does not...) |
| `spreadsheet-acceptance.js` | acceptance checks A1 to A9 (the inline grid and the popup agree, Enter and Update rules, the table is kept on Cancel, spacing around a table, formulas, undo and redo...) |
| `spreadsheet-perf.js`, `perf-compare.js` | speed with the sync checks on and off; speed with plain mouse and keyboard events so the same script runs on current and older code |
| `firefox-run.js`, `firefox-all.js` | faults, regression and acceptance in one paste for Firefox (A7 and A8 need real mouse clicks and are left out) |
| `jitter-film.js` | films every spreadsheet frame by frame when rows are added to the first one; "off0", "off1" are how far each grid sits from its real table |
| `trace-scroll-jumps.js` | finds what makes the page jump (`window.__scrollTrace.report()`) |
| `extract-spreadsheets.js` | collects what is needed to look into a spreadsheet that misbehaves; `REDACT = true` replaces every letter and digit with "x" |
| `repeat-test.py`, `steps-test.py` | repeat a test; the steps (assigner/assignee) test |

Lists of what was tested and by whom: `TEST-LIST.md` (92 numbered tests with status), `CHECKLIST.md` (the living list), `SPREADSHEET-FULL-CHECK.md`
(the thorough run at the end, Firefox and Chrome), `FIREFOX.md` (how to run the scripts in Firefox), `TEST-ACCOUNTS.md` (the local test accounts).

## 9. What covers the Database features of this branch (not the soak)

The soak does not drive these. They are covered by the tests run with
`NODE_PATH=<work>/elabftw/node_modules node --test tests/*.test.cjs` (124 tests reported by the runner at the last run; the table counts the `test(...)` blocks, 120, the runner also counts a few nested ones) and by checks done by hand in the browser:

| File | Tests (written as `test(...)`) | Covers |
|---|---|---|
| `plasmid-search-files.test.cjs` | 42 | the find-by-parts search and plasmid checks, sequence files and the sequence editor, primers panel and its buttons, the Edit primer panel (menu entry, overhang field, locked primer unlock and update with its confirmation, matching bases in the cream box), locking, the order cards (one add button, refresh after adding, search term for names with "/"), the Details fields of the edit page (compact, the order of the sections, Description after Details) |
| `order-page-reader.test.cjs` | 15 | the reader of vendor pages: text of a product page, a screenshot or a PDF turned into columns (target, conjugated, catalog, clone, host...) |
| `primer-similar.test.cjs` | 3 | similar primers (same 3' end with another tail, or up to 3 bases that differ) |
| `spreadsheet-*.test.cjs` | 41 | cell clip, overlay removal debounce, paste hooks, performance, persistence, row layout, undo position, visibility |
| `folder-views.test.cjs`, `back-to-link.test.cjs`, `table-indentation-caret.test.cjs` | 19 | folder views, the back link, indenting a table with the caret in it |

Checks that run outside `node --test`:
- `genbank-primers-check.php` (primers written in a GenBank file) and `link-page-check.php` (the server-side page reader and its safety rules: only
  http and https, ports 80 and 443, no private, local or reserved address, 3 redirects, 6 s, 2 MB). On the host there is no PHP: run them with
  `docker run --rm -v "$PWD":/w:ro --entrypoint php84 elabftw/elabimg:inventory /w/tests/manual/<file>`.
- `ai-search-eval/` (the AI search of plasmids and features, with its README) and `backbone-eval/` (leave-one-out check of the backbone finder).
- Checked live in the browser on the local stack (port 8975), most recently: the order cards for order 12 and 15 (adding, the card refreshing, no duplicate button),
  the Edit primer panel with the unlock confirmation and the overhang field, similar primers in the panel and in the sheet dialog, matching bases and mismatches on the
  map, the compact Details fields at a narrow and a wide window, and the order of the sections on the edit page.
- `zip-export-check.php` (the ZIP export of the Database streams its files: peak PHP memory has to stay under 64 MB however large the attachments are; run it in the web container, see its header).
- `backbone-cache-check.php` (the Backbone finder's cache survives a restart: the table `backbone_cache` of migration 152 gives the same answer when the temporary file is gone; run it in the web container, see its header).

Not covered by any scripted run yet: adding an order line to the Database from a link while the server has internet (checked with a stub only), the edit page re-locking
on leaving, PCR products with tails or a wrapped sequence, the wide-window primer alignment.

## 10. How to add to it

1. Write the scenario in `scenarios` in `spreadsheet-soak.js` (an `async 'name'()` method) and add the name to the default `scenarios` list near the top of `spreadsheetSoak`.
2. Use the helpers (section 6). Call `verify(label, settle)` after every step that changes data, `measure(label)` after every step that changes layout, `consistency(label, true)`
   after a popup or a save, and `save()` at the end. Count what happened with `note(name)`.
3. If the new behaviour has its own rule (a size, a menu), add the check to the helpers so every scenario gets it.
4. Add a line to the table in section 4, a line to the history in section 7, and run it: at least two sessions in Chrome and in Firefox, with the window in front.
5. A change to the spreadsheet code without a scenario or a check here is not finished.
