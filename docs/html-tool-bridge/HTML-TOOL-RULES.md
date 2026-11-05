# Rules for building (or adapting) an HTML tool that sends its data into eLabFTW

Give this file to whoever, or whatever AI, writes or edits an HTML tool. A tool that follows it works on its own in any browser and,
when opened inside eLabFTW (HTML tools side panel, toolbox icon), can put its results into the main text of the experiment being edited.

> Status: the HTML tools feature is switched off in this fork (`FeatureFlags::HTML_TOOLS = false`). These rules describe the bridge as it is
> built (`src/ts/html-tool-bridge.ts`); they apply once the feature is switched on.

## 1. How it works (what you can and cannot do)

- A tool is one self-contained `.html` file, or a `.zip` with an `index.html` (at most 25 MB packed, 75 MB unpacked, 500 files).
- eLabFTW runs it in a **sandboxed iframe**: no access to the page, the session, cookies or the logged-in user, and **no network**
  (`connect-src 'none'`). `fetch`, XHR, WebSocket, Google Sheets/Apps Script, CDNs and web fonts do not work. Put every script, style,
  font and image inside the file (inline or `data:` URIs, or files in the zip).
- The only way out is `window.parent.postMessage(message, '*')`. eLabFTW accepts a message only from the tool's own frame, rebuilds its content
  from plain values (it never runs anything the tool sends) and inserts it at the cursor of the entry being edited, as **one undo step**.
- If no entry is open in edit mode, nothing is inserted and the user is told so. The tool must not depend on a reply to an insert.
- `localStorage` may be unavailable in the sandbox: wrap it in `try/catch` and keep the tool working without it.

## 2. Rules for every tool

1. **Work standalone.** All buttons and calculations must work when the file is opened on its own.
2. **Detect eLabFTW, do not assume it.** `const inElabftw = window.parent !== window;`. Show the "→ eLabFTW" buttons only when it is true.
3. **One button per result**, labelled with the destination, e.g. `Plate → eLabFTW`, `Master mix → eLabFTW`, `Protocol → eLabFTW`.
   Send what the user sees on screen, in the same order, with the same numbers (already rounded and in the same units).
4. **Send values, not markup.** Strings and numbers only. No HTML, no Markdown, no scripts. Anything else is escaped or dropped.
5. **Send once per click.** Never send automatically on load or on every keystroke.
6. **Put the meaning in the data.** Use real column names (`Gene`, `Volume (µL)`), not `Column 1`. Put the unit in the header, not in every cell.
7. **Keep numbers as numbers or plain strings** the user could paste into a spreadsheet (`12.5`, not `12.5 µL (approx.)`).
8. **Stay inside the limits** in section 4; split big results into several messages instead of one huge one.
9. **Do not remove or rename** the tool's existing features when adding the bridge; only add.
10. **No secrets, no personal data** in anything sent; it ends up in the lab notebook.

## 3. Messages

Every message is `{ elabftw: 1, type: '...', ... }`.

### `insert-table` → a spreadsheet with a header row
```js
window.parent.postMessage({
  elabftw: 1, type: 'insert-table',
  caption: 'Master mix',                       // optional
  columns: ['Reagent', 'Volume (µL)'],         // header row
  rows: [['SYBR Green', 10], ['Primer mix', 1], ['Water', 7]]   // strings or numbers
}, '*');
```

### `insert-plate` → a well plate (coloured wells, legend, optional plate table)
```js
window.parent.postMessage({
  elabftw: 1, type: 'insert-plate',
  plateSize: 96,                               // 6, 12, 24, 48, 96 or 384
  caption: 'qPCR plate 1',                     // optional
  groups: [{ name: 'Control', color: '#3b82f6' }, { name: 'Treated', color: '#ef4444' }],   // optional legend
  wells: {                                     // keys are well names: A1 .. H12 (rows A.., columns 1..)
    A1: { label: 'Ctrl 1', group: 'Control' },
    A2: { label: 'Trt 1',  group: 'Treated' },
    B1: { label: 'Own colour', color: '#10b981' }   // a well colour overrides its group colour
  },
  table: {                                     // optional: one row per used well
    columns: ['Sample', 'Gene'],
    rows: { A1: ['Ctrl 1', 'GAPDH'], A2: ['Trt 1', 'GAPDH'] }
  }
}, '*');
```
Colours must be hex (`#rgb`, `#rrggbb`, `#rrggbbaa`); anything else is ignored. One colour group per sample/condition/treatment is the convention.

### `insert-text` → paragraphs of plain text
```js
window.parent.postMessage({ elabftw: 1, type: 'insert-text',
  text: 'Step 1: denature 95 °C, 3 min.\n\nStep 2: 40 cycles of 95 °C 10 s, 60 °C 30 s.' }, '*');   // a blank line starts a new paragraph
```
Link an inventory entry (a resource) with `[[item:ID|label]]`: it becomes a link and the entry is added to the experiment's linked resources.
Use only IDs you got from a search (section 5); labels may not contain `]` or `|`.

## 4. Limits (anything above is cut or refused)

| What | Limit |
|---|---|
| One message | 1 MB (larger is ignored) |
| `insert-text` text | 100 000 characters |
| Table | 399 data rows, 100 columns, 2 000 characters per cell, 120 per column name |
| Caption | 120 characters |
| Plate | sizes 6/12/24/48/96/384; well label 500 characters; group name 80; plate table 20 columns |
| Inventory links per text | 50 |

## 5. Optional: search the eLabFTW inventory from the tool

The tool has no login; the page around it searches with the signed-in user's own session (read-only, sees only what that user may read).
```js
window.parent.postMessage({ elabftw: 1, type: 'search-items', requestId: 'r1', query: 'pLKO', category: 'Plasmid', limit: 20 }, '*');
window.addEventListener('message', e => {
  if (e.source !== window.parent || !e.data || e.data.elabftw !== 1) return;
  // { type: 'items', requestId, items: [{ id, title, category, url, fields: { 'Concentration (ng/µL)': '380' } }] }
  // or { type: 'items-error', requestId, message }
});
```
Always check `e.source === window.parent` and ignore replies whose `requestId` you did not send. Give up after about 15 seconds.
A tool may define `window.elabftwItemLinks = () => [{ id, title }]` to have an "Inventory: ..." line with links added after each table or plate it sends.

## 6. Adapting an existing tool (no rewrite)

1. **Do not touch the tool's logic.** Read what each result block shows and decide which message type fits: a grid of numbers → `insert-table`;
   a plate/rack layout → `insert-plate`; a protocol or summary → `insert-text`.
2. **Quick way, any tool:** add the generic bridge from `pick-bridge.html` with `python3 add-bridge.py in.html out.html`. Inside eLabFTW it adds a bar:
   **Pick → eLabFTW** (click a table or result block to send it) and **Selection → eLabFTW** (send the selected text). Outside eLabFTW it does nothing.
3. **Better way, per tool:** after step 2 add one button per important result, calling `elabftwSend({ type: 'insert-table', ... })` (and `elabftwNote('Sent')`);
   see `extras/` for examples and `qpcr.html` for a full one (look for `eLabFTW BRIDGE`).
4. **Remove everything that needs the network** or replace it (see section 7); otherwise it fails silently in the sandbox.
5. Keep a copy of the original file; the adapted file must still pass the checklist below when opened on its own.

## 7. Things that do not work in the sandbox (and what to do instead)

| Tool feature | Replacement |
|---|---|
| Google Sheets / Apps Script sync, any `fetch` | Search the inventory (section 5) or keep the data in the file; export/import as a file the user selects |
| CDN scripts, fonts, icons | Inline them or put them in the zip |
| `window.open`, popups, downloads via links to other sites | Show the result on the page or send it to the entry |
| Reading the entry's text | Not possible (one-way, tool → entry) |
| Saving settings between sessions | `localStorage` in `try/catch`, or nothing |

## 8. Checklist (tick every line before installing)

- [ ] Opens and works on its own in a browser, no console errors, no network calls.
- [ ] The eLabFTW buttons appear only inside eLabFTW (`window.parent !== window`).
- [ ] Each button sends one message of type `insert-table`, `insert-plate` or `insert-text` with plain values only.
- [ ] Column names, units, captions and well/group names are meaningful; numbers match what the screen shows.
- [ ] Nothing is sent on load; nothing exceeds the limits in section 4.
- [ ] Plate wells use names `A1`..; sizes 6/12/24/48/96/384; colours are `#hex`.
- [ ] Inventory IDs in `[[item:ID|label]]` came from a search.
- [ ] Tested inside eLabFTW: with an entry open in edit mode the result appears at the cursor and one Ctrl+Z removes it; with no entry open the user gets a message and nothing breaks.

## 9. Install

Administration → HTML tools (sysadmin) → upload the `.html` or `.zip`. Open it from the toolbox icon in the side rail.
