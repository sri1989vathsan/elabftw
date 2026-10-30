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

## The other tools: the pick bridge

`pick-bridge.html` is a small block that `add-bridge.py` adds to any tool (`python3 add-bridge.py in.html out.html [extra.html]`). Inside eLabFTW it shows
a bar at the bottom right: **Pick → eLabFTW** (click a table and it is sent as a table; click a result block and it is sent as text; hovering outlines what
will be sent, Esc cancels) and **Selection → eLabFTW** (the text you have selected). Outside eLabFTW it does nothing. Tool-specific buttons go in an extra
file and use `elabftwSend(message)` / `elabftwNote(text)`: `extras/transfection-plate.html` (the painted plate, one colour group per condition) and
`extras/lenti-plates.html` (every filled plate: production, transduction, organoids). Installed this way: AAV Production, Lentivirus, Transfection Batch
Calculator, Golden Gate, Lab Calculator (qPCR has its own buttons, above). Mouse Registry and Freezer Inventory were left as they are.

Tools run with `connect-src 'none'` (see `HtmlToolController.php`), so anything that talks to the network, such as the Google Sheets sync of Mouse
Registry and Freezer Inventory, cannot work inside eLabFTW.

## Inventory search and links

A tool can search the eLabFTW inventory (resources) through the page around it. The tool has no login and no network; the page searches with the
signed-in user's own session, so a tool sees only what that user may read, and a search never writes anything.

```js
elabftwSearchItems('pLKO', { category: 'Plasmid', limit: 20 }).then(items => { /* [{ id, title, category, url, fields: { 'Concentration (ng/µL)': '380', ... } }] */ });
elabftwPickItem({ title: 'Pick a plasmid' }).then(item => { /* a search box with the matches; the chosen entry, or null */ });
```

Both are in `pick-bridge.html` (a tool without it can post `{ elabftw: 1, type: 'search-items', requestId, query, category?, limit? }` and listen for `items` / `items-error`).
`fields` are the entry's extra fields as plain name: value text.

Links: in `insert-text`, `[[item:ID|label]]` becomes a link to that entry and the entry is added to the experiment's linked resources, the same as the `#` mention in
the editor. A tool that defines `window.elabftwItemLinks = () => [{ id, title }]` gets an "Inventory: ..." line with those links inserted after every table or plate it sends.
`extras/transfection-inventory.html` does this for the Transfection Batch Calculator: its plasmid button (📦) searches the eLabFTW inventory instead of opening the Google Sheets
popup, fills the name, concentration (the first extra field with "conc" or "ng" in its name) and stock volume (first field with "vol"), and the plasmids of the conditions that have wells
are linked when the plate or table is inserted.

