# Numbered test list with status

Build 61, 2026-10-12. Chromium tested by Claude; Firefox: faults, acceptance, regression and stress scripts run by the owner.

| # | ID | Test | Status |
|---|----|------|--------|
| 1 | A1 | The inline grid and the popup show the same data, cell for cell | PASS: Chromium x3 passes, Firefox |
| 2 | A2 | Inline: pressing Enter updates the table at once. Popup: the table only changes on Update | PASS: Chromium x3 passes, Firefox |
| 3 | A3 | The table is kept whether the changes are kept or not (Cancel, Escape, closing) | PASS: Chromium x3 passes, Firefox |
| 4 | A4 | The spacing around a table does not change (no blank blocks added or removed) | PASS: Chromium x3 passes, Firefox |
| 5 | A5 | Formulas work in both (typing, results, references updating) | PASS: Chromium x3 passes, Firefox |
| 6 | A6 | Undo and redo work in both, as before | PASS: Chromium x3 passes, Firefox |
| 7 | A7 | Adding and deleting rows and columns works in both | PASS: Chromium, real clicks |
| 8 | A8 | The spreadsheet's look does not change when rows or columns are added or deleted | PASS: Chromium, real clicks |
| 9 | A9 | The formatting buttons work in both (bold, italic, colours, alignment, font size) | PASS: Chromium x3 passes, Firefox |
| 10 | A10 | The table does not jiggle when scrolling | WATCH: Chromium measured, Firefox: you |
| 11 | A11 | First click on a spreadsheet not clicked before, then typing: text goes into the clicked cell (real click, caret previously in the page text) | PASS: real clicks, inline and popup |
| 12 | A12 | Typing a formula and clicking or dragging cells inserts their references (inline and popup) | PASS: real clicks, inline and popup |
| 13 | S1 | Inline edits at varied delays (0 ms to 1.5 s) keep every cell, including formulas | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 14 | S2 | Popup Update applies the edited cells to the table and the grid | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 15 | S3 | Popup Cancel leaves the table and the grid unchanged | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 16 | S4 | Scroll the table away and back, then edit: nothing lost | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 17 | S5 | Edit then save/read content immediately (inside the 500 ms delay): the saved text has the edit | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 18 | S6 | Save, reload the page: every cell matches what was typed | PASS: stress runs (Chromium x3, Firefox), reload check clean |
| 19 | S7 | Fault: change the table behind the grid's back, then verify: detected, grid reloaded, recovery copy kept | PASS: Chromium x3, Firefox |
| 20 | S8 | Fault: conflict (grid edited and the table changed) | PASS: Chromium x3, Firefox |
| 21 | S9 | Fault: an older grid writes over a newer table (stale overlay write) | PASS: Chromium x3, Firefox |
| 22 | S10 | Fault: popup applied after the table changed while it was open | PASS: Chromium x3, Firefox |
| 23 | S11 | Recovery copies can be restored (elabftwSpreadsheetDiagnostics.restoreRecovery(i)) | PASS: Chromium x3, Firefox |
| 24 | S12 | Same stress run in Firefox | PASS: Firefox stress run, 0 failures |
| 25 | S13 | The checks never block a save or Update, even if they throw | Earlier build only, not re-run |
| 26 | E1 | Insert a spreadsheet, type straight away: text goes into the cell and does not stop at the column width | PASS: real clicks (inline and popup) |
| 27 | E2 | Popup: one click on a cell, then type: text goes into that cell (not the page text) | PASS: real clicks (inline and popup) |
| 28 | E3 | While the popup is open, typing never reaches the page text behind it | Earlier builds, not re-run on 61 |
| 29 | E4 | Popup Cancel after editing a cell and confirming does not delete the table | PASS: real clicks (inline and popup) |
| 30 | E5 | Inline: click a cell after the caret was in the page text, then type: text goes into the cell | PASS: real clicks (inline and popup) |
| 31 | E6 | Escape in a cell editor restores the original value (inline and popup) | PASS: Escape inline, real keys |
| 32 | E7 | Right-click a row number, Insert row above / below, on a row whose height was changed | Earlier builds, not re-run on 61 |
| 33 | E8 | Inserted rows and columns look like the rest of the table | PASS: alignment kept on new rows and columns |
| 34 | E9 | Right-click a cell, insert column before/after | PASS: real clicks (inline and popup) |
| 35 | E10 | Tables do not wiggle or lag when scrolling up and down | WATCH: Chromium measured, Firefox: you |
| 36 | E11 | Blank lines under a table: the reserved-space block cannot be deleted, an empty paragraph can | Accepted as is |
| 37 | M1 | Right-click a cell: the menu opens next to the pointer, not far away | PASS: real clicks |
| 38 | M2 | Cell menu: Insert a new row before / after, Delete selected rows | PASS: real clicks |
| 39 | M3 | Right-click a column header: Insert a new column before / after, Delete selected columns | PASS: real clicks |
| 40 | M4 | Right-click a row number, including on a row whose height was changed: insert and delete work | PASS on an unresized row; resized row not tested |
| 41 | M5 | The menu closes on a click elsewhere and on Escape, and no second menu stays open | PASS: real clicks |
| 42 | M6 | A table near the bottom of the screen: the menu flips upward and stays fully visible | PASS: real clicks |
| 43 | M7 | After inserting or deleting through the menu, the grid and the saved table agree, and the look is unchanged (alignment, widths) | PASS: real clicks |
| 44 | M8 | Copy... , Paste... and Save as... items in the menu behave | NOT TESTED (needs clipboard, manual) |
| 45 | M9 | Add comments item (cell menu) works or is hidden by choice | FAIL, low priority (note not saved) |
| 46 | M10 | Menus are cleaned up: after scrolling past tables many times, no leftover menu elements stay in the page | PASS: leak test x2 (no leftover menus) |
| 47 | M11 | A table opened from a page with several tables: the menu belongs to the table that was clicked | NOT TESTED on its own |
| 48 | M12 | Right-click while a cell is being edited does not lose the typed text | PASS: real clicks |
| 49 | R1 | Tables far from the screen show a light preview; the first click makes one live and selects the clicked cell; the preview looks like the live grid (wi | PARTIAL: first click on a preview works; look not compared |
| 50 | R2 | The horizontal scroll bar never covers the last row of a live table | NOT TESTED |
| 51 | R3 | Double-click a cell and type: nothing is lost (the 2026-10-02 data-loss fix) | Covered by stress runs (double-click editing) |
| 52 | R4 | Cell formatting (bold, colours, alignment) set in the popup survives Update, save and reload | PASS: Chromium x3, Firefox (R4 failed once in pass 1, not repeated) |
| 53 | R5 | Fill handle (drag a cell's corner) copies formulas correctly, including $ references (2026-10-02 fix) | NOT TESTED |
| 54 | R6 | Ctrl+Z in the main text does not undo spreadsheet edits, and the table's own undo does not touch the text | PASS: Chromium x3, Firefox (R4 failed once in pass 1, not repeated) |
| 55 | R7 | An autosave while you are typing in a cell does not interrupt the typing | PASS: Chromium x3, Firefox (R4 failed once in pass 1, not repeated) |
| 56 | R8 | Delete a spreadsheet with the trash icon, then press Ctrl+Z | OPEN: your decision (Ctrl+Z does not restore a deleted spreadsheet) |
| 57 | R9 | Copy and paste a range inside a table, between two tables, and from Excel; pasted PDF tables are cleaned up | Not re-run today (outside this work) |
| 58 | R10 | Drag a column or row border to resize (with the size guide); autofit rows and columns; sizes survive save and reload | Not re-run today (outside this work) |
| 59 | R11 | Double-click a table's cell edits in place and does not open the popup unexpectedly | Not re-run today (outside this work) |
| 60 | R12 | Autosave and manual save work on a page that has many tables and large tables | Not re-run today (outside this work) |
| 61 | R13 | Spreadsheet caption and the inline "Edit title" button; the table of contents lists spreadsheets under their title, with show/hide switches for spread | Not re-run today (outside this work) |
| 62 | R14 | Insert a spreadsheet of any size from the grid picker, "Custom spreadsheet", the Benchling-style data table and a well plate | Not re-run today (outside this work) |
| 63 | R15 | The view page shows spreadsheets read-only, loads them lazily, and "copy table" works | Not re-run today (outside this work) |
| 64 | R16 | Print and PDF export include the spreadsheet values (formula results, not formulas) | Not re-run today (outside this work) |
| 65 | R17 | Tab and Shift+Tab indent several selected list lines at once | Not re-run today (outside this work) |
| 66 | R18 | Picture captions show on top, in the editor and in the view; captioned pictures can be resized | Not re-run today (outside this work) |
| 67 | R19 | Goals, Notes and Conclusion changes appear in the changelog | Not re-run today (outside this work) |
| 68 | R20 | Template version history: open, compare, restore an older version, the others kept | Not re-run today (outside this work) |
| 69 | R21 | Boards dialogs open centred beside an open sidebar; the file list is shown once and without the horizontal action buttons | Not re-run today (outside this work) |
| 70 | R22 | Revisions: the number kept and the minimum days between them behave as before; timestamping an experiment still works | Not re-run today (outside this work) |
| 71 | R23 | Sysadmin can edit Key features entries and upload a picture; other users cannot | Not re-run today (outside this work) |
| 72 | R24 | Real click: put the text caret in the page text, then click ONCE in a spreadsheet that has not been clicked before (still a preview) and type: the tex | PASS: real clicks, inline and popup |
| 73 | R25 | Real click: while typing a formula (=, =SUM(, after +), clicking or dragging cells inserts their references, inline and in the popup | PASS: real clicks, inline and popup |
| 74 | R26 | Right-click a cell: the table stays below the editor toolbar and the site menu bar (it must not paint on top of them) while the menu is open | PASS (R27 also confirmed by you) |
| 75 | R27 | Scrolling: when the top nav bar hides or shows, the editor's menu bar and toolbar glide with the back/save bar, no single-frame jump | PASS (R27 also confirmed by you) |
| 76 | R28 | Delete on a selected cell or range clears it at once, with no editor opened; undo brings it back; inline and popup; grid and saved table agree | PASS: real keys, inline and popup (F2 popup: one early miss, not repeated: WATCH) |
| 77 | R29 | F2 on a selected cell opens its editor with the current content, same as a double-click; Enter commits, Escape cancels; inline and popup | PASS: real keys, inline and popup (F2 popup: one early miss, not repeated: WATCH) |
| 78 | P1 | 5 tables, none live | Measured on builds 52-55, not re-run on 61 |
| 79 | P2 | 30 tables, 9 live grids | Measured on builds 52-55, not re-run on 61 |
| 80 | P3 | One table of 300 x 30 cells | Measured on builds 52-55, not re-run on 61 |
| 81 | P4 | Typing into a big table, one cell at a time | Measured on builds 52-55, not re-run on 61 |
| 82 | P5 | Scrolling past 30 tables | Measured on builds 52-55, not re-run on 61 |
| 83 | P6 | Mounting a table (first click) before and after the sync checks | Measured on builds 52-55, not re-run on 61 |
| 84 | P7 | Checks on versus off, 25 extra tables, 5 rounds | Measured on builds 52-55, not re-run on 61 |
| 85 | P8 | Memory over 24 popup-open/cancel/scroll cycles | PASS: leak test x2, build 61 (heap +0.8 MB, elements back to start) |
| 86 | P9 | Page load, 5 tables | Measured on builds 52-55, not re-run on 61 |
| 87 | P10 | Scaling, 10 / 30 / 60 tables, all grids live (worst case), reading the content | Measured on builds 52-55, not re-run on 61 |
| 88 | R30 | Sync warning has a Restore previous version button (only that spreadsheet changes), keeps the replaced version, offers Undo restore | PASS (build 63; Chromium) |
| 89 | R31 | Drag over several row numbers (or select a range of cells over several rows), right-click inside it, Delete selected rows: every selected row is deleted at once; grid and saved table agree; undo works; right-clicking outside the selection deletes only that row; inline and popup | PASS (build 22): real drag + right-click, inline 8 to 5 rows and popup 6 to 3 rows, Update keeps the result |
| 90 | R32 | Same for columns: select several column letters or a range over several columns, right-click inside it, Delete selected columns: all selected columns are deleted; grid and saved table agree; inline and popup | PASS (build 22): real drag + right-click, inline 5 to 2 columns and popup 5 to 2 columns, Update keeps the result |
| 91 | R33 | An indented spreadsheet: the Table menu (toolbar and Insert > Tables) still offers Outdent and Indent table after clicking in its grid; pressing Enter below it gives a paragraph that is not indented | PASS (real clicks): grid click then Table menu offers Indent; after indenting it offers Outdent and Indent |
| 92 | R34 | A spreadsheet with a long title in a narrow table: the header stays one line with the title cut short by an ellipsis (full title on hover) and the buttons stay on the right | PASS (measured, wraps when too narrow): title keeps one line with ellipsis, buttons wrap to a second row, none cut off |
