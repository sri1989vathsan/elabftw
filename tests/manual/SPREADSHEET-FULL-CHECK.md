# Spreadsheet full check (everything flagged so far)

For the thorough run you do at the end, in Firefox and in Chrome, as many times as needed.
Fill the two browser columns with PASS, FAIL or a note. "Where" says whether to test the
inline grid (in the page), the popup (double-click or the open-editor button), the view page,
or the saved/printed table.

Status of "last result" comes from `TEST-LIST.md` and `CHECKLIST.md`; the items under C and D
are new in this round and have not been looked at in a browser yet unless it says so.

## A. Flagged earlier and still open (not tested, only partly tested, or a known problem)

| # | Ref | What to check | Where | Last known result | Firefox | Chrome |
|---|-----|---------------|-------|-------------------|---------|--------|
| A1 | M8 | Copy, Paste and Save as items in the right-click menu | inline, popup | not tested (needs the clipboard) | | |
| A2 | M9 | "Add comments" in the cell menu: works, or is hidden on purpose | inline, popup | fails, low priority (the note is not saved) | | |
| A3 | M11 | On a page with several tables, the right-click menu belongs to the table you clicked | inline | not tested on its own | | |
| A4 | M4 | Right-click a row number of a row whose height you changed: insert above/below and delete | inline, popup | passes on an unresized row; resized row not tested | | |
| A5 | E7 | Same for "Insert row above/below" on a resized row | inline, popup | earlier build only | | |
| A6 | R1 | Far-away tables show a light preview; the first click makes one live and selects that cell; the preview looks like the live grid (widths, heights) | inline | first click works; look not compared | | |
| A7 | R2 | The horizontal scroll bar never covers the last row of a live table | inline | not tested | | |
| A8 | R3 | Double-click a cell and type: nothing is lost (2026-10-02 data-loss fix) | inline, popup | covered by the stress runs | | |
| A9 | R5 | Fill handle (drag a cell's corner) copies formulas, `$` references stay fixed | inline, popup | not tested | | |
| A10 | R8 | Delete a spreadsheet with the trash icon, then Cmd/Ctrl+Z: does it come back at the same place with its content (your decision pending: it does not today) | inline | open | | |
| A11 | Cmd+Z | In the popup, delete rows, then Cmd/Ctrl+Z: the rows come back | popup | flagged: did not restore | | |
| A12 | R9 | Copy and paste a range inside a table, between two tables, and from Excel; pasted PDF tables are cleaned | inline, popup | not re-run | | |
| A13 | R10 | Drag a column or row border (size guide shows); autofit rows and columns; sizes survive save and reload | inline, popup | not re-run | | |
| A14 | R11 | Double-click in a cell edits in place and does not open the popup by accident | inline | not re-run | | |
| A15 | R12 | Autosave and manual save with many and with large tables | inline | not re-run | | |
| A16 | R13 | Caption and "Edit title"; the table of contents lists spreadsheets under their title with show/hide switches | inline, TOC | not re-run | | |
| A17 | R14 | Insert from the grid picker, "Custom spreadsheet", the Benchling-style table and a well plate | menu | not re-run | | |
| A18 | R15 | View page shows spreadsheets read-only, lazily loaded, and "Copy table" works | view | not re-run | | |
| A19 | R16 | Print and PDF export show the values (formula results, not formulas) | print, PDF | not re-run | | |
| A20 | R17 to R23 | Tab and Shift+Tab indent lines; picture captions; Goals/Notes/Conclusion in the changelog; template version history; boards dialogs beside the sidebar; revisions; Key features editing | various | not re-run (outside the spreadsheet work) | | |
| A21 | A10 / E10 | The table does not jiggle or lag when scrolling up and down | inline | measured in Chromium only | | |
| A22 | S13 | The sync checks never block a save or Update, even if one throws | inline, popup | earlier build only | | |
| A23 | E3 | While the popup is open, typing never reaches the page text behind it | popup | earlier builds only | | |
| A24 | P1 to P10 | Speed: 5/30/60 tables, one 300 x 30 table, typing into a big table, scrolling past 30 tables, memory over 24 popup cycles, page load | inline | measured on older builds, not re-run | | |

## B. Fixed or changed in earlier rounds, re-check

| # | Ref | What to check | Where | Last known result | Firefox | Chrome |
|---|-----|---------------|-------|-------------------|---------|--------|
| B1 | R31 | Select several rows (drag row numbers, or a range of cells), right-click inside it, Delete selected rows: all of them go; grid and saved table agree; undo works | inline, popup | pass (Chromium); you ran it in Firefox | | |
| B2 | R32 | Same for several columns | inline, popup | pass | | |
| B3 | R33 | An indented spreadsheet: the Table menu still offers Outdent and Indent after clicking in its grid; Enter below it gives a non-indented paragraph | inline | pass | | |
| B4 | R34 | A spreadsheet with a long title in a narrow table: the title is cut with an ellipsis (full title on hover) and the buttons stay on the right on one line | inline | pass (measured) | | |
| B5 | R28, R29 | Delete clears a selected cell or range at once; F2 opens the cell editor; Enter commits, Escape cancels | inline, popup | pass | | |
| B6 | R30 | The sync warning has "Restore previous version" and it only restores that spreadsheet | inline | pass (Chromium) | | |
| B7 | R4, A9 | Formatting (bold, colour, alignment, size) set in the popup survives Update, save and reload | popup | pass | | |
| B8 | 2026-10-02 | The three old bugs: double-click scatter, popup formatting, fill-handle `$` references | inline, popup | fixed and verified once | | |

## C. New in this round (built, not yet looked at in your browsers)

| # | What to check | Where | Firefox | Chrome |
|---|---------------|-------|---------|--------|
| C1 | A freshly inserted spreadsheet shows all its rows with no extra scrolling inside it and no row cut off at the bottom (was about 9 px too short). Try 5 x 5, 10 x 10 and a taller one (20+ rows, like your header-bar example with 21 rows) | inline | | |
| C2 | In a row whose height you set (drag it taller, or autofit), the text sits in the middle of the cell, or at the top or bottom if the cell is set that way, not stuck at the top | inline, popup | | |
| C3 | The same after save and reload, and in the view page and print | view, print | | |
| C4 | A well plate inserts straight into the text, with no popup, for every size (6, 12, 24, 48, 96, 384) | menu | | |
| C5 | **Well plate headers**: letters down the side (A, B, C ...) and numbers across the top (1, 2, 3 ...), the opposite of a normal sheet. Check in the page, the popup, the view page and the saved table (the saved table already did this) | inline, popup, view, saved table | | |
| C6 | A well plate after adding or deleting a row or a column: the headers stay in the plate style (letters side, numbers top) and keep counting correctly | inline, popup | | |
| C7 | A well plate that has formulas: formulas still use spreadsheet names (column letter first, then row number), so `A2` is column A, row 2, which is not the well labelled A2 on the plate. Confirm that is acceptable, or tell me | inline, popup | | |
| C8 | A normal spreadsheet is unchanged: letters across the top, numbers down the side | inline, popup | | |
| C9 | Well plate and normal spreadsheet side by side in one entry | inline | | |
| C11 | A wide spreadsheet (384-well plate, 24 columns): the editor frame itself must not scroll sideways or show empty space to the right; only the grid's own scroll bar moves. Check at several window widths, in Firefox especially (reported there) | inline | | |
| C10 | Delete a step, comment or file with the new in-page confirmation; the spreadsheet trash icon still asks | inline | | |

## C2. New in the stress round of 2026-10-27 (check in Firefox)

| # | What to check | Where | Firefox | Chrome |
|---|---------------|-------|---------|--------|
| E1 | Click a cell, type a value, press Enter, type another: the page does not scroll away from the table and no keystroke is lost or lands in the text | inline, plates too | | |
| E2 | Hold Enter under a table 40 times: the text is never scrolled inside the editor frame | inline | | |
| E3 | A 160-row data table: the preview has no big blank gap below it | inline | | |
| E4 | Right-click Paste / Paste transposed, and Ctrl/Cmd+Shift+V | inline, popup | | |
| E5 | Well plate: type labels and fill colours in the Spreadsheet view, switch to Plate and back, reload: all kept | plates | | |
| E6 | A plate up to 96 wells is as wide as the 96-well plate; the 384-well plate stays smaller | plates | | |
| E7 | Insert > Well plate > Insert from file: always asks the plate size; Colour by / Label by follow the table | plates | | |

## D. Cross-cutting (do these in every run)

| # | What to check | Firefox | Chrome |
|---|---------------|---------|--------|
| D1 | After each rebuild, reload with a hard refresh (Cmd+Shift+R), so the page is not running an old script | | |
| D2 | Open the browser console during the run: no red errors | | |
| D3 | Reload and check again: every cell, style and size matches what you left | | |
| D4 | Run the scripts in `tests/manual/` (`spreadsheet-acceptance.js`, `spreadsheet-faults.js`, `spreadsheet-regression.js`, `spreadsheet-sync-stress.js`, `spreadsheet-perf.js`) and note any failure | | |
| D5 | Repeat the whole sheet at least three times; note anything that fails only once | | |

## F. Added 2026-11-17

| # | What to check | Where | Soak scenario | Firefox | Chrome |
|---|---------------|-------|---------------|---------|--------|
| F1 | Cmd/Ctrl+X on one cell: the cell is empty in the grid and in the saved table at once, and the text is on the clipboard (paste it elsewhere) | inline, popup | `cut-undo` | | |
| F2 | Cmd/Ctrl+X on a dragged range: every cell of the range is emptied, one Cmd/Ctrl+Z brings all of them back (grid and saved table), Cmd/Ctrl+Shift+Z cuts them again | inline, popup | `cut-undo` | | |
| F3 | Cut, then reload: the cut cells are still empty; undo, save, reload: they are back | inline, popup | `cut-undo` (+ `spreadsheetSoakAfterReload`) | | |
| F4 | Default cell padding is 8 px all round (was 6; a table that already stores its own padding keeps it, the Cell padding box changes it), in the page, the popup and the view page; text never touches the grid lines | inline, popup, view | `padding-fit` | | |
| F5 | A column nobody sized grows to fit its longest value (up to 360 px) when the table is opened; a column you sized is left alone; the table does not shrink | inline, popup, view | `padding-fit` | | |

## G. Soak coverage (`spreadsheet-soak.js`, run `spreadsheetSoak({ seed: 1, sessions: 1 })`)

Rows of A to F that a scenario exercises. The rest need a real mouse, the clipboard or a printer and stay manual.

| Items | Scenarios |
|-------|-----------|
| A3, A8, A14, E1, E2 (typing, double-click, Enter, Tab, nothing lost) | `back-to-back`, `spaced-out`, `enter-semantics`, `enter-last-row`, `tab-then-type`, `sink-text`, `type-then-resize`, `popup-direct-typing` |
| A9, B8 (fill handle, formulas, `$`) | `formulas-and-structure`, `drag-select` |
| A11, A4, A5, B1, B2 (row and column insert and delete, undo) | `multi-delete`, `formulas-and-structure`, `undo-everything` |
| A12, E4 (copy, paste, paste transposed, from another application) | `copy-paste`, `paste-external`, `copy-table-format`, `paste-range-format` |
| A13 (sizes, autofit, survive save) | `type-then-resize`, `undo-everything` |
| A15 (autosave and save) | `autosave-in-grid` |
| A17, C4 to C9, C11, E5 to E7 (inserts, well plates, wide plate) | `plate-day`, `wide-plate`, `back-to-back` |
| A21, A24 (jiggle, speed, memory) | every run (timings, memory, scroll jiggles in the report) |
| B5, F1 to F3 (Delete, F2, Escape, Cmd+X) | `enter-semantics`, `sink-text`, `cut-undo` |
| B7, C2, C3 (formatting survives, vertical alignment) | `format-and-popup`, `format-after-typing`, `colour-live`, `default-border-apply` |
| undo and redo of everything | `undo-redo`, `undo-everything`, `cut-undo` |
| find and replace in grids | `find-in-grid` |
| F4, F5 (padding, fit) | `padding-fit` |
| right-click menus (A3, M-items) | every step (menu checks in the report) |
