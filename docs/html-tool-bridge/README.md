# HTML tools: sending results to the main text

The HTML tools of this fork (the side panel with the toolbox icon, installed by a sysadmin as one `.html` file or a `.zip`) run in a
sandboxed frame: they cannot read the page or the session. A tool can still hand a result to the experiment being edited by posting a
message to the page around it. eLabFTW (`src/ts/html-tool-bridge.ts`) accepts messages only from the tool frame, rebuilds what they
carry (plain strings, colours checked) and inserts it at the cursor as one undo step. Nothing is inserted when no entry is being edited.

```js
// inside the tool
const inElabftw = window.parent !== window;           // false when the page is opened on its own
window.parent.postMessage({ elabftw: 1, type: 'insert-table', caption: 'Master mix', columns: ['Gene', 'µL'], rows: [['GAPDH', 12.5]] }, '*');
```

| `type` | what it carries | what the entry gets |
|---|---|---|
| `insert-plate` | `plateSize` (6, 12, 24, 48, 96 or 384), `caption?`, `wells: { A1: { label?, group?, color? }, ... }`, `groups?: [{ name, color }]`, `table?: { columns: string[], rows: { A1: string[] } }` | a well plate with coloured wells, its legend and, when given, its plate table |
| `insert-table` | `caption?`, `columns: string[]`, `rows: (string \| number)[][]` | a spreadsheet with a header row |
| `insert-text` | `text` (blank lines start a new paragraph) | paragraphs of plain text |

Limits: a message is ignored above 1 MB, text above 100 000 characters is cut, a table has at most 399 rows.

`qpcr.html` in this folder is the qPCR protocol builder of https://moors-code.github.io/Lab_Protocols/ with three buttons added, shown only
inside eLabFTW: **Plate → eLabFTW** (the plate map as a well plate, one colour group per sample, the sample and gene of each well in the
plate table), **Master mix → eLabFTW** (the master-mix volumes as a table) and **Protocol → eLabFTW** (the protocol text). The other tools
need the same small block (look for `eLabFTW BRIDGE` in the file) and one button per result.

Install a tool: Administration, HTML tools (sysadmin), upload the file. Open it from the toolbox icon on any page; on an edit page the
buttons insert into the main text.
