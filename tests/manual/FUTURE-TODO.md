# Future to-do (not started, agreed to do later)

## 1. Personal editor toolbar (asked 2026-10-15)

Let each user choose which buttons are in their own editor toolbar, by right-clicking an item.

- Right-click a toolbar button or a menu entry (Insert menu, menu bar): "Add to my toolbar" or "Remove from my toolbar", plus "Reset toolbar to default".
- Stored per user in the database (follows the user across browsers), not only in the browser.
- The toolbar is built at editor start from the default list plus the user's additions, minus what they hid. A change reloads the editor (after saving the text) or applies on the next page load.
- New buttons go at the end of the toolbar at first; moving them around is a later step.
- Wrap each addable item as its own toolbar button.
- Candidate items (user to confirm which): Spreadsheet (size picker), Well plate (size list), Table…, Insert title, Insert date, Insert divider, Notes, Insert template; Web link, Upload and link a file or folder, File/folder reference, LabCollector item; Autofit column widths, Autofit row heights, Table style, Cell style, Outdent/Indent table. Menu bar items (Find and replace, Code sample, ...) later.
- Needs: a migration (one column per user), a rebuild, tests (both browsers), and a line in the editor toolbar guide card.
- Rough size: 2 to 3 hours.

## 2. Spreadsheet width and size (asked 2026-10-15, parked)

- Wide tables (384-well plate, 24 columns) need sideways scrolling inside the grid. Ideas: narrower default columns for big plates (about 40 px each, so 96 and 384 wells fit at the usual editor width; the code is a few lines in `createWellPlateSpreadsheetData`), and a way to make a spreadsheet wider or narrower.
- A drag handle under the grid to set a maximum visible height, with scrolling inside (saved with the table). About 1-2 h, moderate risk to the table/grid sync code, needs the full spreadsheet check after.
- Already done: the editor frame no longer scrolls sideways into empty space when a wide spreadsheet is present.

## 3. Parked on purpose

- Replace the remaining native confirm() boxes (about 55) with the in-page confirmation. Decision on 2026-10-15: leave them alone for now. Only step delete, comment delete and Apply to Read & Write use the in-page version.
