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

## D. Cross-cutting (do these in every run)

| # | What to check | Firefox | Chrome |
|---|---------------|---------|--------|
| D1 | After each rebuild, reload with a hard refresh (Cmd+Shift+R), so the page is not running an old script | | |
| D2 | Open the browser console during the run: no red errors | | |
| D3 | Reload and check again: every cell, style and size matches what you left | | |
| D4 | Run the scripts in `tests/manual/` (`spreadsheet-acceptance.js`, `spreadsheet-faults.js`, `spreadsheet-regression.js`, `spreadsheet-sync-stress.js`, `spreadsheet-perf.js`) and note any failure | | |
| D5 | Repeat the whole sheet at least three times; note anything that fails only once | | |
