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

## 2. Parked on purpose

- Replace the remaining native confirm() boxes (about 55) with the in-page confirmation. Decision on 2026-10-15: leave them alone for now. Only step delete, comment delete and Apply to Read & Write use the in-page version.
