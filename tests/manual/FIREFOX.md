# Running the spreadsheet tests in Firefox

Use a throwaway experiment (create one, open it in edit mode). The scripts only touch scratch
tables, but the editor autosaves.

## Scripted checks (about 3 minutes)
1. Open the experiment's edit page, wait for the editor, open the console (Cmd+Opt+K). Type
   `allow pasting` and press Enter the first time.
2. Paste, one after the other, the full contents of:
   `tests/manual/spreadsheet-faults.js`, `spreadsheet-regression.js`, `spreadsheet-acceptance.js`
   (each ends with `})();`; wait for `undefined` before the next).
3. Paste the contents of `tests/manual/firefox-run.js`. When it finishes it prints one
   `group ID: PASS/FAIL` line per check. Send me the lines that say FAIL (or all of them).
   If a run fails, reload the page before running again (a half-finished run leaves state behind).

## Stress run (about 3 minutes, separate page load)
1. Reload the edit page, paste `tests/manual/spreadsheet-sync-stress.js`, then
   `const report = await spreadsheetSyncStress({ seed: 7, rounds: 40 }); JSON.stringify(report)`
   (it can exceed the console's wait; if so, run it without `await` and read
   `window.spreadsheetSyncStressReport` when `window.spreadsheetSyncStressProgress.round` reaches 40).
2. Reload the page and run `await spreadsheetSyncStressAfterReload()`.

## By hand (these need real mouse clicks)
- **R31 rows:** insert a spreadsheet (Insert > Table > Spreadsheet, 8 rows), drag down over row
  numbers 2, 3, 4, right-click inside the selection, "Delete selected rows": all three go. Repeat in the
  popup (the expand icon), then press Update. Right-click a row outside the selection: only that row goes.
- **R32 columns:** same with column letters B, C, D and "Delete selected columns", inline and popup.
- **R33:** click in a spreadsheet, open the table menu in the toolbar, choose "Indent table to align
  with nested bullets"; click in the grid again and open the menu: both Outdent and Indent are listed.
  Click below the table and press Enter: the new paragraph is not indented.
- **R34:** give a spreadsheet a long title (the H button), make the table narrow (2 columns): the title
  stays on one line with "…", the buttons wrap to a second row and none is cut off.
- **A7 / A8:** right-click > insert row before/after and column before/after; the new row/column take
  the look of their neighbour, and the original cells keep theirs.
