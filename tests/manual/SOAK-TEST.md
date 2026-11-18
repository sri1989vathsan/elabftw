# Spreadsheet soak test

`tests/manual/spreadsheet-soak.js` drives the spreadsheets of an entry (inline grid, popup editor, the stored HTML table behind them) the way a
person does, and after every step checks that the three copies of a table agree and that nothing was lost. Keep this file current: every
spreadsheet bug that is reported, and every spreadsheet fix, gets a scenario in the default list of the script and a line below.

## How to run

Use a SCRATCH experiment (the test adds and removes its own spreadsheets). Open it in edit mode, logged in, then in the console:

```js
await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/spreadsheet-soak.js'; s.onload = r; document.head.append(s); });
const report = await spreadsheetSoak({ seed: 22, sessions: 1, randomRounds: 50 });   // about 15 minutes, all scenarios
```

- One or a few scenarios: `spreadsheetSoak({ seed: 5, sessions: 1, scenarios: ['formulas-and-structure', 'popup-wide-scroll'] })`.
- Options: `seed`, `sessions` (how often the whole set repeats), `randomRounds` (steps of `mixed`), `scenarios`, `settleMs`, `quick`.
- A long run does not have to be awaited: start it without `await`, read `window.spreadsheetSoakProgress` while it runs and
  `window.spreadsheetSoakReport` when it is done. In the Browser pane (a hidden page runs timers slowly) poll in short loops (under 40 s per call).
- After a reload: `await spreadsheetSoakAfterReload()` compares what was saved with the record and removes the scratch tables.
- Parallel runs: one scratch experiment per run (seeds 11, 22, 33 were used), headless Firefox through Marionette (`scratchpad/ffm.py`) or the Browser pane (Chromium).
- **Clipboard scenarios run in Chromium only** (headless Firefox has no real clipboard).
- Flags: `window.__noMinDimSync = true` before starting switches the minDimensions sync off (A/B); `window.__forceOverlayScrollbars = true` shows the popup's own scroll bar.

## Diagnostics (in the report or on `window`)

| Name | What it gives |
|---|---|
| `window.__jssMenuDiag` | what the last right-click Insert / Delete did: the sheet it acted on, sizes before and after, skipped or not |
| `window.__popupScrollInfo` | the popup's scroller (overflow, scrollLeft, widths) for the popup-scroll scenarios |
| `window.__noMinDimSync` | A/B switch of `syncMinDimensions()` (the fix of the insert/delete TypeError) |
| width-desync probe | the first time a live worksheet's first data row is wider or narrower than its header row / column list, with the operation and the ops before it |
| error-time dump | the live worksheets as they were when a page error was thrown |
| `window.spreadsheetSoakLive` / `spreadsheetSoakProgress` / `spreadsheetSoakReport` | live counters, progress, final report (data loss, failures, size problems, menu problems, page errors) |

## Scenarios (default list, in this order)

B = runs in both Firefox and Chromium; C = Chromium only (needs the clipboard).

| Scenario | What it checks | Runs in |
|---|---|---|
| plate-day | a day of work with a well plate: insert, type, switch Plate / Spreadsheet | B |
| back-to-back | tables inserted one after the other keep their data | B |
| spaced-out | tables with text between them: nothing around them changes | B |
| copy-paste | copy a table and paste it inside the page | C |
| wide-plate | a 96/384 plate view and its sheet view agree | B |
| format-and-popup | formatting in the inline grid reaches the popup and back | B |
| enter-last-row | Enter in the last row adds nothing; typing then insert/delete right after keeps all values; rows stay the same height | B |
| multi-delete | deleting several rows/columns at once: grid, stored table and record agree, nothing comes back | B |
| date-then-header | a header under an inserted date does not bring an empty line | B |
| type-then-resize | typed header text survives a column resize right after | B |
| enter-semantics | Enter commits and stays, a second Enter moves down, in the last row it stays | B |
| tab-then-type | after Tab the cursor is on the next cell and typing acts on it | B |
| sink-text | text that reaches the hidden input without key presses (input methods, dictation) | B |
| format-after-typing | a format button pressed while typing keeps the text | B |
| filler-click | the grey filler columns: a click adds the columns up to it | B |
| filler-revert | filler columns come and go without jitter; clicking around adds or removes none | B |
| autosave-in-grid | edits are saved without leaving the grid | B |
| popup-direct-typing | typing straight over cells in the popup, Update keeps everything | B |
| paste-external | a table pasted from another application: centred vertically, editable at once | C |
| paste-outside-widths | widths from Excel/Sheets/Word (col in pt, style-block class, width attribute) are kept | C |
| paste-copy-widths, paste-copy-widths-rich | a copy of one of our own sheets pasted through the paste handler keeps the column widths | C |
| undo-redo, undo-everything | Ctrl+Z / Ctrl+Shift+Z walk back and forward through inserts, deletes, typing and resizes | C |
| copy-table-format, paste-range-format | Copy table and a range copy carry values and formatting | C |
| default-border-apply | the table default border and Apply appearance reach every cell that still follows the default | B |
| colour-live | a colour picked in the popup applies by itself after a short pause | B |
| popup-wide-scroll | a sheet wider than the popup: the scroller has overflow-x, scrollLeft can be set, the last column letter becomes visible, the toolbar stays put (new) | B |
| popup-own-scrollbar | the popup's own thin scroll bar (overlay mode): thumb smaller than the track, dragging scrolls, End/Home work (new) | B |
| text-column-fits | a sheet of 3 long texts made by typing, external HTML paste, plain tab-separated paste and the insert command: text is left-aligned, never cut off unless the column is at its 360 px cap, pasted/created sheets are fitted (new) | B (pastes by event) |
| preview-equals-live | the preview before the first click equals the live grid: column widths, row heights, alignment, and the content below does not move (new) | B |
| no-stray-column-row | pasted 3x1 and 3x2 sheets stay 3x1 / 3x2: no column of 1,2,3 and no empty row nobody added (new) | B |
| toast-inside-viewport | the app's own toasts/tooltips stay inside the window with a margin and do not cover the column letters (the "Last sync was successful" box is the Polybox client, not this page) (new) | B |
| inline-scrollbar-thin | the scroll bar of a wide inline sheet is thin, like the popup's (new) | B |
| drag-select | dragging over cells selects; the fill handle lets go and comes back | B |
| cut-undo | Ctrl+X removes from grid and stored table, one Ctrl+Z brings it back, redo cuts again | C |
| padding-fit | text keeps 8 px from the cell edges; a long value up to the 360 px cap is not clipped | B |
| formulas-and-structure | a formula never loses its formula and references follow when rows/columns are inserted or deleted (needs `syncMinDimensions`) | B |
| mixed | random rounds of everything above, checking the sizes after every step | B |

`find-in-grid` (Find and replace marks exactly one current match) is also in the list; it needs a word no earlier run left in the page (the test makes a unique one).

## Known test artefacts (not app bugs)

- Headless Firefox has no clipboard: copy/paste scenarios report "paste made 0 spreadsheets" there. Run them in Chromium.
- A scripted right-click at the top of the screen lands under the sticky bar: "no menu appeared" (about 1 per run).
- find-in-grid used to report 0 or 2 current matches because earlier runs left the same word in other tables: the word is unique now.
- "editor sticks out sideways" in the editor-size check depends on the content of the scratch page (Compact showed more of it than Comfortable).
- In a hidden Browser pane timers run slowly; keep polling calls under about 40 s.

## Results of the last full runs (3 parallel runs, seeds 11 / 22 / 33, headless Firefox, about 15 minutes each)

| | Build 31 (before the fix) | Build 36 (after) | Build 46 (final UI) |
|---|---|---|---|
| Page errors (`reading 'style'`, `records[t] is undefined`) | 0 / 6 / 1 | 0 / 0 / 0 | 0 / 0 / 0 |
| Structure data loss (insert/delete, formulas) | seed 22 about 75 lines, seed 33 6 | 0 / 0 / 0 | 0 / 1 line / 0 |
| find-in-grid "exactly one current match" | 2 per seed | 0 | 0 |
| Clipboard scenarios (headless Firefox only) | 8-9 per seed | 8-9 per seed | 8-9 per seed |
| mixed "size NxM instead of ..." | seed 11 | all 3 seeds | seeds 11 and 33 (7 each) |
| Slowing down | none | none | none |

Chromium, formulas-and-structure + popup-wide-scroll + paste-copy-widths, Comfortable and Compact interface size: 0 data loss, 0 failures, 0 page errors in both.

## Open items

1. **mixed: size shrink** ("size 5x4 instead of 5x7", then "cell F5 not found"): rows missing from the stored table after a long mixed run. Not reproducible when `mixed` runs alone (4 A/B runs with and without the minDimensions sync). Next: run the full soak in Chromium with the dump and the desync probe, bisect which earlier scenario leaves the page in the state, compare stored size and grid size after each "add rows" and "enter in last row". Medium.
2. **One-column drift, seed 22, mixed round 12** ("col-before: size changed by 0 rows and -2 columns, expected +1"): looks like the grey-filler cleanup (`dropEmptyColumnsFrom`) removing two empty columns at the moment of the insert. Needs a targeted repro (filler press, then Insert column before, in Chromium). Medium-low.
3. **Cosmetic**: scroll jiggle (0 / 45 / 70 events per seed) and a taller last row after "row-before" in Firefox (49 px against 33 px).
