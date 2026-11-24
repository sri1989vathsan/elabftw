/**
 * Soak test for spreadsheets in the editor: realistic working sessions, repeated.
 *
 * What it checks, in order of importance:
 *   1. DATA LOSS. Every cell typed (or kept through an insert/delete of rows and columns, a popup
 *      Update, a copy and paste, a save) is compared with the script's own record, in the live grid
 *      and in the saved table, after every step; and once more after the page is reloaded.
 *   2. Editor size. After each step the editor's width and height are measured: the frame must not
 *      be wider than the page or scroll sideways, grids must stay inside it, and the editor must not
 *      be much taller than its content (or cut it off).
 *   3. Right-click menus. Right-click a cell, a row number and a column letter, at the top and at the
 *      bottom of the screen: the menu must be fully on screen, next to the pointer, on top of
 *      everything else, close again, and leave nothing behind.
 *   4. Slowing down. Time of every kind of step, memory, page size and leftover grids are tracked
 *      across the sessions; the first and the last part of the run are compared.
 *
 * Scenarios (each is a typical way of working): a 96-well plate day, several spreadsheets inserted
 * one after the other, spreadsheets spaced out with text between them, a copy of a spreadsheet pasted
 * right after it and further down, a 384-well plate (wide), and a mixed random working session.
 *
 * Use a SCRATCH experiment: the test adds and removes its own spreadsheets in the text. (What was on the page
 * before is left alone, and the date-and-header scenario puts the page's own text back when it is done.)
 *
 * Run it from the browser console on an experiment's EDIT page (logged in), Firefox or Chrome:
 *
 *     const report = await spreadsheetSoak({ seed: 1, sessions: 3 });
 *     console.log(JSON.stringify(report, null, 2));
 *
 * Options: seed, sessions (how many times the whole set is repeated), randomRounds (steps in the mixed
 * scenario, default 30), scenarios (names to run), settleMs, quick (shorter waits, fewer rounds).
 * A long run can be started without waiting: spreadsheetSoak({...}); then read
 * window.spreadsheetSoakProgress while it runs and window.spreadsheetSoakReport when it is done.
 *
 * Afterwards reload the page and run:   const after = await spreadsheetSoakAfterReload();
 * It compares what was saved with the record, then removes the scratch tables.
 * Only cell text that this script itself typed is ever held by it.
 */
async function spreadsheetSoak(options = {}) {
  const config = {
    seed: 1, sessions: 2, randomRounds: 30, settleMs: 900, quick: false, keepTables: false,
    scenarios: ['plate-day', 'back-to-back', 'spaced-out', 'copy-paste', 'wide-plate', 'format-and-popup', 'enter-last-row', 'multi-delete', 'date-then-header', 'type-then-resize', 'enter-semantics', 'tab-then-type', 'sink-text', 'format-after-typing', 'filler-click', 'filler-revert', 'filler-then-insert-column', 'filler-then-menu-race', 'filler-then-popup', 'autosave-in-grid', 'popup-direct-typing', 'paste-external', 'paste-outside-widths', 'paste-copy-widths', 'paste-copy-widths-rich', 'undo-redo', 'undo-everything', 'copy-table-format', 'paste-range-format', 'default-border-apply', 'colour-live', 'find-in-grid', 'popup-wide-scroll', 'popup-own-scrollbar', 'popup-own-scrollbar-y', 'popup-scrollbar-after-resize', 'popup-header-look', 'header-not-tall-when-all-rows-wrap', 'text-column-fits', 'text-not-clipped', 'paste-keeps-formatting', 'cell-alignment-consistent', 'alignment-preserved', 'toolbar-not-cut', 'row-height-fits-text', 'editor-height-after-removal', 'undo-typing-over-text', 'preview-equals-live', 'no-stray-column-row', 'toast-inside-viewport', 'inline-scrollbar-thin', 'viewport-equals-table-width', 'drag-select', 'formulas-and-structure', 'cut-undo', 'padding-fit', 'bars-after-scroll-back', 'mixed'],
    ...options,
  };
  if (config.quick) { config.randomRounds = Math.min(config.randomRounds, 10); config.settleMs = 600; }
  const api = window.elabftwSpreadsheetDiagnostics;
  if (!api) throw new Error('The spreadsheet diagnostics are not loaded: open an experiment in edit mode.');
  const editor = tinymce.activeEditor;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frames = n => new Promise(resolve => {
    let i = 0;
    const next = () => {
      if (++i >= n) { resolve(); return; }
      let fired = false;
      requestAnimationFrame(() => { fired = true; next(); });
      setTimeout(() => { if (!fired) { fired = true; next(); } }, 120);
    };
    next();
  });
  let rngState = config.seed >>> 0 || 1;
  const random = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = list => list[Math.floor(random() * list.length)];

  const originalConfirm = window.confirm;
  window.confirm = () => true;
  const dataLoss = [];
  const failures = [];
  let scrollJiggles = 0;
  const sizes = { checks: 0, widest: 0, taller: 0, shorter: 0, problems: [] };
  const menus = { checked: 0, problems: [] };
  const timings = {};
  const samples = [];
  const counts = {};
  const opLog = [];
  // columns after each step of the mixed session: model, live grid, stored table (to see which step loses columns)
  const colTrail = [];
  const note = name => { counts[name] = (counts[name] || 0) + 1; opLog.push(name); if (opLog.length > 60) opLog.shift(); };
  const t0 = performance.now();
  // Width desync diagnostic: the first time the live worksheet's first data row is wider (or narrower) than its header
  // row / column list, with the operation, round and the ops before it. (jspreadsheet's createRow needs them equal.)
  const desync = [];
  const jssState = uid => {
    const root = api.overlayElement(uid); const holder = root && [...root.querySelectorAll('.jss_container')].find(el => el.jssWorksheet);
    const w = holder && holder.jssWorksheet;
    if (!w) return null;
    return { data0: w.options.data && w.options.data[0] ? Object.keys(w.options.data[0]).length : null, headers: w.headers ? w.headers.length : null, columns: w.options.columns ? w.options.columns.length : null, rows: w.options.data ? w.options.data.length : null, records0: w.records && w.records[0] ? w.records[0].length : null };
  };
  const checkDesync = (uid, when) => {
    const st = jssState(uid);
    if (!st) return;
    if (st.data0 !== st.headers || (st.columns != null && st.columns !== st.headers) || (st.records0 != null && st.records0 !== st.headers)) {
      if (desync.length < 6) desync.push({ when, context, state: st, previousOps: opLog.slice(-6) });
    }
  };
  window.spreadsheetSoakLive = { dataLoss, failures, sizes, menus, desync };
  const baselineTables = api.snapshot(false).length;
  const baselineUids = new Set(api.snapshot(false).map(snap => snap.uid));
  let baselineGone = false;
  const baselinePageWidth = document.documentElement.scrollWidth;
  const models = new Map();
  let context = 'start';

  const cellName = (r, c) => {
    let label = ''; let n = c;
    do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return label + (r + 1);
  };
  // While the tab or pane is not on screen the browser slows animation frames and timers down a great deal, so
  // steps that ran partly in the background are kept apart and left out of the slowdown comparison.
  const hiddenRuns = {};
  const timed = async (name, fn) => {
    const start = performance.now();
    const hiddenAtStart = document.hidden;
    try { return await fn(); } finally {
      const took = Math.round(performance.now() - start);
      if (hiddenAtStart || document.hidden) hiddenRuns[name] = (hiddenRuns[name] || 0) + 1;
      else (timings[name] ||= []).push(took);
    }
  };
  const fail = (problem, extra = {}) => failures.push({ context, problem, ...extra });

  // ---- tables ---------------------------------------------------------------------------
  const tableEl = uid => editor.getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${uid}"]`);
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);
  const live = async uid => {
    const table = tableEl(uid);
    if (!table) throw new Error(`table ${uid} is missing`);
    // Asked for again a few times: on a busy machine (two soaks at once, a slow page) the grid can take longer
    // than one short wait to come up, which stopped whole scenarios with "root is null".
    for (let attempt = 0; attempt < 5; attempt++) {
      table.scrollIntoView({ block: 'center' });
      await sleep(attempt === 0 ? 300 : 700);
      api.mountLive(uid);
      await sleep(attempt === 0 ? 450 : 900);
      const overlay = api.overlayElement(uid);
      if (overlay) { if (attempt > 0) note('grid-needed-retry'); return overlay; }
    }
    throw new Error(`the grid of table ${uid} did not come up after 5 tries`);
  };

  async function createTable(label, { rows = 5, cols = 4, plate = 0 } = {}) {
    layoutDirty = true;
    const uid = await timed('insert-table', async () => {
      const id = api.insertScratch(rows, cols, plate ? { plate } : undefined);
      await sleep(700);
      return id;
    });
    if (!uid) { fail(`could not insert ${label}`); return null; }
    const table = tableEl(uid);
    const grid = Array.from({ length: table.rows.length - 1 }, () => Array.from({ length: table.rows[0].cells.length - 1 }, () => ''));
    models.set(uid, { label, grid, plate: !!plate });
    note(plate ? `insert-plate-${plate}` : 'insert-table');
    if (!plate) { try { api.mountLive(uid); await sleep(400); await rowHeightsUniform(uid, 'a new spreadsheet'); } catch (error) { /* checked again later */ } }
    return uid;
  }

  async function editCell(root, r, c, value, key = 'Tab') {
    const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    if (!td) throw new Error(`cell ${cellName(r, c)} not found`);
    // a real double click is two presses of the cell first: they select it and tell the page editor that a grid is in use
    press(td); await sleep(80);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box) throw new Error(`no cell editor opened for ${cellName(r, c)}`);
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // Tab by default: it moves on without changing the grid. Enter in the last row stays there and adds nothing.
    box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await frames(2);
  }

  async function typeInto(uid, r, c, value, key = 'Tab') {
    await timed('type-in-cell', async () => {
      const root = await live(uid);
      await editCell(root, r, c, value, key);
    });
    const model = models.get(uid);
    model.grid[r][c] = value;
    // Enter commits and stays in the cell; only a second Enter (see enterAgain) moves down, and in the last row it stays.
    note(key === 'Enter' ? 'type-with-enter' : 'type-in-cell');
  }

  // ---- newer interactions: typing straight over a cell, a second Enter, resizing, text without key presses ----
  const selectedCells = root => [...root.querySelectorAll('td.highlight-selected')].map(t => [Number(t.dataset.x), Number(t.dataset.y)]);
  const blankRow = n => Array.from({ length: n }, () => '');
  async function selectCell(uid, r, c) {
    const root = await live(uid);
    const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    if (!td) throw new Error(`cell ${cellName(r, c)} not found`);
    press(td); await sleep(220);
    return root;
  }
  // Typing straight over a selected cell: the first key is a real keydown (it opens the stable editor), the rest of
  // the text goes into the box. finish: 'Enter' | 'Tab' | null (leave the editor open, as when a resize follows).
  async function typeDirect(uid, r, c, value, finish = 'Enter') {
    const model = models.get(uid);
    const root = await selectCell(uid, r, c);
    const first = value[0];
    (document.activeElement || root).dispatchEvent(new KeyboardEvent('keydown', { key: first, code: `Key${first.toUpperCase()}`, bubbles: true, cancelable: true }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box) { fail(`typing "${first}" over ${cellName(r, c)} did not open the editor`, { table: model.label }); return false; }
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    if (finish) box.dispatchEvent(new KeyboardEvent('keydown', { key: finish, bubbles: true, cancelable: true }));
    await frames(2);
    model.grid[r][c] = value;
    note(finish ? 'type-direct' : 'type-direct-left-open');
    if (finish === 'Enter') {
      await sleep(120);
      const sel = selectedCells(api.overlayElement(uid) || root);
      // Since 2026-10-27 Enter while editing commits and moves to the next row; in the last row the cursor stays.
      const expectedRow = r < model.grid.length - 1 ? r + 1 : r;
      if (sel.length !== 1 || sel[0][0] !== c || sel[0][1] !== expectedRow) dataLoss.push({ context, table: model.label, problem: `Enter in ${cellName(r, c)} should leave the cursor on row ${expectedRow + 1}, it is on ${JSON.stringify(sel)}` });
    }
    return true;
  }
  // Diagnostic: the row heights saved in each table right now (and what the stored rows say), kept on window for a later read.
  const dumpSavedHeights = label => {
    const decode = raw => { try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); } catch (e) { try { return JSON.parse(atob(raw)); } catch (e2) { return null; } } };
    window.spreadsheetSoakRowDump = window.spreadsheetSoakRowDump || [];
    window.spreadsheetSoakRowDump.push({ label, tables: Array.from(editor.getBody().querySelectorAll('table.elabftw-spreadsheet')).map(t => ({ saved: decode(t.dataset.spreadsheet || '')?.rowHeights ?? null, trs: Array.from(t.querySelectorAll('tbody > tr')).map(tr => (tr.getAttribute('style') || '-').replace('height: ', '').replace(';', '')).join(',') })) });
  };
  // A second Enter with the cell only selected: down one cell; at the last row it stays (Enter never adds a row).
  async function enterAgain(uid) {
    const model = models.get(uid);
    const root = await live(uid);
    const before = selectedCells(root);
    if (before.length !== 1) { fail('enterAgain needs one selected cell', { table: model.label, selected: before }); return; }
    const [c, r] = before[0];
    const rowsBefore = (api.overlayElement(uid) || root).querySelectorAll('.jss_worksheet tbody tr').length;
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(500);
    const after = selectedCells(api.overlayElement(uid) || root);
    const rowsAfter = (api.overlayElement(uid) || root).querySelectorAll('.jss_worksheet tbody tr').length;
    if (rowsAfter !== rowsBefore) dataLoss.push({ context, table: model.label, problem: `a second Enter in ${cellName(r, c)} changed the number of rows (${rowsBefore} to ${rowsAfter}): Enter must never add a row` });
    const wantRow = Math.min(r + 1, model.grid.length - 1);
    if (after.length !== 1 || after[0][0] !== c || after[0][1] !== wantRow) {
      dataLoss.push({ context, table: model.label, problem: `a second Enter in ${cellName(r, c)} should select ${cellName(wantRow, c)}, selection is ${JSON.stringify(after)}` });
    }
    note('enter-again');
  }
  // Drag the right edge of a column header, falling back to a double click on it (autofit): both end in the same
  // resize callback, which is what used to replace typed values with older ones.
  async function resizeColumn(uid, c) {
    const root = await live(uid);
    const header = root.querySelector(`.jss_worksheet thead td[data-x="${c}"]`);
    if (!header) { fail(`column header ${c} not found`); return false; }
    const rect = header.getBoundingClientRect();
    const x = rect.right - 2; const y = rect.top + rect.height / 2;
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
    const widthBefore = Math.round(rect.width);
    header.dispatchEvent(new PointerEvent('pointerdown', init));
    header.dispatchEvent(new MouseEvent('mousedown', init));
    for (let i = 1; i <= 5; i++) { header.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: x + i * 12 })); await sleep(15); }
    header.dispatchEvent(new MouseEvent('mouseup', { ...init, clientX: x + 60, buttons: 0 }));
    await sleep(500);
    let widthAfter = Math.round((api.overlayElement(uid) || root).querySelector(`.jss_worksheet thead td[data-x="${c}"]`).getBoundingClientRect().width);
    if (widthAfter === widthBefore) {
      note('resize-drag-not-applied');
      const again = (api.overlayElement(uid) || root).querySelector(`.jss_worksheet thead td[data-x="${c}"]`);
      const r2 = again.getBoundingClientRect();
      again.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: r2.right - 2, clientY: r2.top + r2.height / 2, button: 0 }));
      await sleep(500);
      widthAfter = Math.round((api.overlayElement(uid) || root).querySelector(`.jss_worksheet thead td[data-x="${c}"]`).getBoundingClientRect().width);
    }
    note('resize-column');
    return widthAfter !== widthBefore;
  }
  // Every cell of the grid and of the stored table sits in the vertical middle.
  function verticalAlignCheck(uid, label) {
    const root = api.overlayElement(uid); const table = tableEl(uid); const model = models.get(uid);
    const off = [];
    root?.querySelectorAll('.jss_worksheet tbody td[data-x]').forEach(td => { if (getComputedStyle(td).verticalAlign !== 'middle') off.push(`grid ${td.dataset.x},${td.dataset.y}`); });
    table?.querySelectorAll('td').forEach((td, i) => { if (getComputedStyle(td).verticalAlign !== 'middle') off.push(`table cell ${i}`); });
    note('vertical-align-check');
    if (off.length) fail(`${label}: ${off.length} cells are not vertically centred (${off.slice(0, 4).join(', ')})`, { table: model?.label });
  }

  // Text through the grid's hidden input (input methods, dictation), committed with Enter.
  async function sinkTextInto(uid, r, c, text) {
    const model = models.get(uid);
    const root = await selectCell(uid, r, c);
    const sink = root.querySelector('.jss_textarea');
    if (!sink) { fail('the grid has no hidden input', { table: model.label }); return false; }
    sink.focus(); sink.value = text;
    sink.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box || box.value !== text) { fail(`text put in the hidden input was not handed to the cell editor (${box ? JSON.stringify(box.value) : 'no editor'})`, { table: model.label, cell: cellName(r, c) }); return false; }
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await frames(2);
    model.grid[r][c] = text;
    note('sink-text');
    return true;
  }
  // A click on a grey cell beside the grid: adds the columns up to it. false when the grid already fills the width.
  async function fillerAdd(uid) {
    const model = models.get(uid);
    let root = await selectCell(uid, 0, 0);
    let filler = null;
    for (let i = 0; i < 40 && !(filler = (api.overlayElement(uid) || root).querySelector('.elabftw-spreadsheet-filler')); i++) await sleep(100);
    root = api.overlayElement(uid) || root;
    if (!filler) { note('filler-no-room'); return false; }
    // the grey filler is redrawn every 400 ms (more on a busy machine): press it once it shows the columns the grid has now, or the cell that is
    // pressed belongs to the old width ("clicking a grey cell should leave 13 columns, there are 12" in one slow soak run)
    for (let i = 0; i < 40; i++) {
      filler = (api.overlayElement(uid) || root).querySelector('.elabftw-spreadsheet-filler') || filler;
      if (Number(filler.dataset.cols) === (api.overlayElement(uid) || root).querySelectorAll('.jss_worksheet thead td[data-x]').length) break;
      if (i === 0) note('filler-behind-grid');
      await sleep(100);
    }
    const cols = model.grid[0].length;
    // the app takes the empty grey columns off again when a press lands outside the table (Save, the page, a menu of the page): the record remembers
    // the width before the first press and applies that rule when it compares sizes
    if (model.fillerBase === undefined) model.fillerBase = cols;
    const cell = pick([...filler.querySelectorAll('.fc[data-i][data-r]')]);
    if (!cell) return false;
    const i = Number(cell.dataset.i); const rr = Number(cell.dataset.r);
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
    await sleep(1000);
    root = api.overlayElement(uid) || root;
    const gotCols = root.querySelectorAll('.jss_worksheet thead td[data-x]').length;
    if (gotCols !== Math.min(cols + i + 1, 50)) dataLoss.push({ context, table: model.label, problem: `clicking a grey cell should leave ${Math.min(cols + i + 1, 50)} columns, there are ${gotCols}` });
    model.grid.forEach(row => { while (row.length < gotCols) row.push(''); });
    note('filler-click');
    return true;
  }
  // A table pasted from another application (all cells carry the source's own tight style).
  async function pasteExternal(rows, label) {
    layoutDirty = true;
    const before = new Set(api.snapshot(false).map(snap => snap.uid));
    const cellStyle = 'padding:0px 1px;vertical-align:bottom;line-height:12px;height:15px';
    const html = `<table><tbody>${rows.map(row => `<tr>${row.map(v => `<td style="${cellStyle}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    editor.selection.select(editor.getBody(), true); editor.selection.collapse(false);
    const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', rows.map(r => r.join('\t')).join('\n'));
    editor.getDoc().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(1200);
    const added = api.snapshot(true).filter(snap => !before.has(snap.uid));
    if (added.length !== 1) { fail(`an external paste made ${added.length} spreadsheets, expected 1`); return null; }
    const uid = added[0].uid;
    models.set(uid, { label, grid: rows.map(r => r.slice()), plate: false });
    return uid;
  }
  async function undoKey(uid, shift) {
    const root = api.overlayElement(uid);
    const target = document.activeElement && root.contains(document.activeElement) ? document.activeElement : root.querySelector('.jss_textarea');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: !!shift, bubbles: true, cancelable: true }));
    await sleep(380);
  }
  // Ctrl+X in the grid: copies the selection and clears it (one undo step), as Delete does.
  async function cutKey(uid) {
    const root = api.overlayElement(uid) || await live(uid);
    const target = document.activeElement && root.contains(document.activeElement) ? document.activeElement : root.querySelector('.jss_textarea');
    // The Ctrl+X key itself needs a real key press (the browser only lets a page copy then), so the test sends the
    // cut event that the key press, the Edit menu and the context menu all lead to.
    target.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    await sleep(380);
  }
  async function boldCell(uid, r, c, leaveTypingOpen) {
    const root0 = api.overlayElement(uid) || await live(uid);
    openFormatBar(root0); await sleep(300);
    if (!leaveTypingOpen) { press(root0.querySelector(`td[data-x="${c}"][data-y="${r}"]`)); await sleep(200); }
    const button = findButton(root0, ['Bold']);
    if (!button) { fail('the Bold button was not found'); return null; }
    button.click(); await sleep(600);
    return (api.overlayElement(uid) || root0).querySelector(`td[data-x="${c}"][data-y="${r}"]`);
  }

  // The diagnostics drop trailing empty rows and columns, so the record is cut the same way.
  const trim = grid => {
    const rows = grid.map(row => row.slice());
    while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
    let width = 0;
    rows.forEach(row => { for (let i = row.length; i > 0; i--) if (row[i - 1] !== '') { width = Math.max(width, i); break; } });
    return rows.map(row => row.slice(0, width));
  };
  // ---- anomalies: stray spaces, stray blank lines, text that moved, tables that vanished -------------
  // The text outside the spreadsheets must only change when the test itself changes it, and nothing may
  // appear around a table on its own (an empty line, a spacer, a non-breaking space).
  let layoutDirty = true;           // set whenever the test itself inserts, pastes or writes text
  let lastOutside = null;
  const outsideSignature = () => {
    const kids = Array.from(editor.getBody().children).filter(el => !el.hasAttribute('data-mce-bogus') && !el.hasAttribute('data-elabftw-spreadsheet-spacer'));
    const parts = kids.map(el => {
      if (el.tagName === 'TABLE' && el.classList.contains('elabftw-spreadsheet')) return 'TABLE';
      const text = (el.textContent || '').replace(/[​﻿]/g, '');
      const empty = text.replace(/[\s ]/g, '') === '' && !el.querySelector('img, table, hr');
      return empty ? `${el.tagName}:EMPTY` : `${el.tagName}:${text}`;
    });
    return { parts, empties: parts.filter(p => p.endsWith(':EMPTY')).length, tables: parts.filter(p => p === 'TABLE').length, spacers: editor.getBody().querySelectorAll('[data-elabftw-spreadsheet-spacer]').length };
  };
  function layoutCheck(label) {
    const now = outsideSignature();
    note('layout-check');
    if (lastOutside && !layoutDirty) {
      const same = JSON.stringify(now.parts) === JSON.stringify(lastOutside.parts);
      if (!same) {
        // describe the first difference in words
        const a = lastOutside.parts; const b = now.parts; let i = 0;
        while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
        dataLoss.push({ context: label, problem: `the text around the spreadsheets changed by itself at block ${i + 1}: ${JSON.stringify(a[i] ?? '(end)')} became ${JSON.stringify(b[i] ?? '(end)')}`, empties: `${lastOutside.empties} to ${now.empties}`, tables: `${lastOutside.tables} to ${now.tables}` });
      }
      if (now.spacers > now.tables) dataLoss.push({ context: label, problem: `${now.spacers} layout spacers for ${now.tables} spreadsheets (spacers piling up)` });
    }
    lastOutside = now;
    layoutDirty = false;
  }
  // Cells are compared exactly (no trimming): a space, a non-breaking space or a hidden character that
  // was not typed is an anomaly.
  function exactCellCheck(uid, label) {
    const model = models.get(uid);
    const table = tableEl(uid);
    if (!model || !table) return;
    let stored = null;
    try { stored = JSON.parse(decodeURIComponent(escape(atob(table.getAttribute('data-spreadsheet'))))).data; } catch (error) { return; }
    note('exact-cell-check');
    (stored || []).forEach((row, r) => (row || []).forEach((value, c) => {
      const text = value == null ? '' : String(value);
      if (/^\s|\s$| |​|﻿|  /.test(text) && text !== (model.grid[r]?.[c] ?? '')) {
        dataLoss.push({ context: label, table: model.label, where: 'stored cell', cell: cellName(r, c), problem: `extra whitespace or hidden character in the cell: ${JSON.stringify(text)}` });
      }
      const expected = model.grid[r]?.[c] ?? '';
      if (r < model.grid.length && c < (model.grid[0]?.length ?? 0) && text !== expected && text.trim() === expected.trim() && text !== expected) {
        dataLoss.push({ context: label, table: model.label, where: 'stored cell', cell: cellName(r, c), problem: `differs only by spaces: expected ${JSON.stringify(expected)} found ${JSON.stringify(text)}` });
      }
    }));
  }

  // ---- 1. data loss ---------------------------------------------------------------------
  // settle=false: only the live grid (the table trails it by the editor's 500 ms write delay).
  async function verify(label, settle) {
    context = label;
    if (settle) await sleep(config.settleMs);
    const snaps = api.snapshot(true);
    const uids = snaps.map(snap => snap.uid);
    if (new Set(uids).size !== uids.length) fail('two spreadsheets share one id (a copy was not given its own)');
    // Spreadsheets that were on the page before the run are left alone; anything else that is not in the
    // record is a leftover, and a recorded one that is missing is checked below.
    const strangers = snaps.filter(snap => !models.has(snap.uid) && !baselineUids.has(snap.uid));
    if (strangers.length) dataLoss.push({ context, problem: `${strangers.length} spreadsheet(s) on the page that the test did not make and that were not there at the start` });
    const missingBefore = [...baselineUids].filter(uid => !snaps.some(snap => snap.uid === uid));
    if (missingBefore.length && !baselineGone) { baselineGone = true; fail(`${missingBefore.length} spreadsheet(s) that were on the page before the run are gone (the test should not touch them)`); }
    for (const [uid, model] of models) {
      const snap = snaps.find(entry => entry.uid === uid);
      if (!snap) { dataLoss.push({ context, table: model.label, problem: 'the spreadsheet is gone' }); continue; }
      const compare = (where, grid) => {
        if (!grid) return;
        const want = trim(model.grid); const got = trim(grid);
        const rowsN = Math.max(want.length, got.length);
        const colsN = Math.max(want[0]?.length ?? 0, got[0]?.length ?? 0, ...want.map(r => r.length), ...got.map(r => r.length));
        for (let r = 0; r < rowsN; r++) {
          for (let c = 0; c < colsN; c++) {
            const expected = want[r]?.[c] ?? ''; const have = got[r]?.[c] ?? '';
            // a formula whose references moved with an inserted or deleted column (=A1+1 became =B1+1) is the app doing its job: the record follows;
            // formulas-and-structure checks the references strictly
            if (have !== expected && String(expected).startsWith('=') && String(have).startsWith('=') && model.grid[r]) { model.grid[r][c] = have; continue; }
            if (have !== expected) dataLoss.push({ context, table: model.label, where, cell: cellName(r, c), expected, have });
          }
        }
      };
      const dom = tableEl(uid);
      // the empty grey columns of a filler press are gone after a press outside the table: when the saved table is back at the width from before the
      // press and everything the record holds beyond it is empty, the record follows
      if (dom && settle && model.fillerBase !== undefined) {
        const base = model.fillerBase;
        const storedCols = dom.rows[0].cells.length - 1;
        const extraEmpty = model.grid.every(row => row.slice(base).every(value => String(value ?? '') === ''));
        if (!extraEmpty) model.fillerBase = undefined;
        else if (storedCols === base && model.grid[0].length > base) { model.grid.forEach(row => { row.length = base; }); model.fillerBase = undefined; note('filler-columns-taken-off'); }
      }
      if (dom && settle && (dom.rows.length - 1 !== model.grid.length || dom.rows[0].cells.length - 1 !== model.grid[0].length)) {
        dataLoss.push({ context, table: model.label, where: 'saved table', problem: `size ${dom.rows.length - 1}x${dom.rows[0].cells.length - 1} instead of ${model.grid.length}x${model.grid[0].length}`, lastOps: opLog.slice(-16).join(' > '), colTrail: colTrail.slice(-14).join(' > ') });
      }
      if (snap.live && !snap.editing) compare('grid', snap.overlayData);
      if (settle) compare('saved table', snap.tableData);
    }
    if (settle) {
      for (const uid of models.keys()) exactCellCheck(uid, context);
      layoutCheck(context);
      for (const check of api.verify('soak-check')) {
        if (!['ok', 'skipped'].includes(check.status) && models.has(check.uid)) fail(`editor reported ${check.status}`, { table: models.get(check.uid).label });
      }
    }
  }

  // ---- 2. editor size -------------------------------------------------------------------
  const lastSize = { frame: 0, content: 0 };
  async function measure(label) {
    await sleep(450);
    // a hidden page does not redraw, so the editor has not been resized yet: nothing to judge then
    if (document.hidden) { note('size-check-skipped-hidden'); return; }
    const container = editor.getContainer();
    const iframe = container.querySelector('iframe');
    const doc = editor.getDoc();
    const html = doc.documentElement;
    const box = container.getBoundingClientRect();
    const parent = container.parentElement.getBoundingClientRect();
    const pageWidth = document.documentElement.clientWidth;
    const problems = [];
    sizes.checks++;
    sizes.widest = Math.max(sizes.widest, Math.round(box.width));
    if (box.width > parent.width + 2) problems.push(`editor ${Math.round(box.width)} px wide inside a ${Math.round(parent.width)} px column`);
    if (box.right > pageWidth + 2) problems.push('editor reaches past the right edge of the page');
    if (document.documentElement.scrollWidth > Math.max(pageWidth, baselinePageWidth) + 2) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth} px in ${pageWidth} px)`);
    if (html.scrollWidth > html.clientWidth + 2) problems.push(`editor frame scrolls sideways (${html.scrollWidth} px in ${html.clientWidth} px)`);
    const frameHeight = iframe.getBoundingClientRect().height;
    const contentHeight = Math.max(doc.body.scrollHeight, doc.body.offsetHeight);
    const extra = Math.round(frameHeight - contentHeight);
    sizes.taller = Math.max(sizes.taller, extra);
    sizes.shorter = Math.min(sizes.shorter, extra);
    if (extra > 160) problems.push(`editor is ${extra} px taller than its content`);
    // Cut off only when the frame's own document overflows: the hidden stored table behind a plate (or any table the live grid
    // is shorter than) pokes out of the body by a few pixels, a negative margin pulls the text up, and nothing visible is lost.
    if (extra < -6 && html.scrollHeight - html.clientHeight > 2) problems.push(`editor is ${-extra} px shorter than its content (cut off)`);
    document.querySelectorAll('.elabftw-spreadsheet-editor-overlay').forEach(overlay => {
      const rect = overlay.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < box.left - 3 || rect.right > box.right + 3)) problems.push('a spreadsheet sticks out of the editor sideways');
    });
    lastSize.frame = Math.round(frameHeight); lastSize.content = Math.round(contentHeight);
    problems.forEach(problem => { if (sizes.problems.length < 40) sizes.problems.push({ context: label, problem }); });
  }

  // ---- 3. right-click menus -------------------------------------------------------------
  // The context menu acts on mouse down/up, so a bare click() does nothing: press it like a mouse would.
  const clickMenuItem = item => {
    const b = item.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: b.x + 10, clientY: b.y + 8, button: 0, buttons: 1 };
    item.dispatchEvent(new PointerEvent('pointerdown', init));
    item.dispatchEvent(new MouseEvent('mousedown', init));
    item.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    item.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  };
  const openMenu = () => [...document.querySelectorAll('.jcontextmenu, .jss_contextmenu')]
    .find(menu => getComputedStyle(menu).display !== 'none' && menu.getBoundingClientRect().width > 0);
  async function menuCheck(root, target, where, label) {
    const rect = target.getBoundingClientRect();
    const x = rect.x + Math.min(rect.width / 2, 40); const y = rect.y + rect.height / 2;
    // A real right-click: button down, button up, then the menu event.
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 2, buttons: 2 };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('contextmenu', init));
    await sleep(300);
    const menu = openMenu();
    menus.checked++;
    const problem = text => { if (menus.problems.length < 40) menus.problems.push({ context, target: label, where, problem: text }); };
    if (!menu) { problem('no menu appeared'); return null; }
    const m = menu.getBoundingClientRect();
    if (m.left < -1 || m.top < -1 || m.right > innerWidth + 1 || m.bottom > innerHeight + 1) problem(`menu partly off screen (${Math.round(m.left)},${Math.round(m.top)} to ${Math.round(m.right)},${Math.round(m.bottom)} in ${innerWidth}x${innerHeight})`);
    const gapX = x < m.left ? m.left - x : (x > m.right ? x - m.right : 0);
    const gapY = y < m.top ? m.top - y : (y > m.bottom ? y - m.bottom : 0);
    if (Math.max(gapX, gapY) > 90) problem(`menu ${Math.round(Math.max(gapX, gapY))} px away from the pointer`);
    const probeX = m.left + m.width / 2; const probeY = Math.min(m.bottom - 4, m.top + 12);
    const top = document.elementFromPoint(probeX, probeY);
    if (!top || !menu.contains(top)) problem(`menu is covered by ${top ? (top.className || top.tagName) : 'nothing'}`);
    if (menu.querySelectorAll('a, button, li').length === 0) problem('menu has no items');
    return menu;
  }
  async function closeMenu(label, where) {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    if (openMenu()) { menus.checked++; if (menus.problems.length < 40) menus.problems.push({ context, target: label, where, problem: 'menu did not close' }); }
  }
  async function menuTour(uid) {
    note('menu-tour');
    await timed('menu-tour', async () => {
      const table = tableEl(uid);
      for (const where of ['top of screen', 'bottom of screen']) {
        table.scrollIntoView({ block: where === 'top of screen' ? 'start' : 'end' });
        window.scrollBy(0, where === 'top of screen' ? -120 : 120);
        await sleep(350);
        api.mountLive(uid);
        await sleep(400);
        const root = api.overlayElement(uid);
        if (!root) { fail('no live grid for the menu check'); continue; }
        const targets = [
          ['cell', root.querySelector('.jss_worksheet tbody td[data-x][data-y]')],
          ['row number', root.querySelector('.jss_worksheet tbody td.jss_row')],
          ['column letter', root.querySelector('.jss_worksheet thead td[data-x]')],
        ];
        for (const [label, target] of targets) {
          if (!target) continue;
          const r = target.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) continue; // not on screen from here
          await menuCheck(root, target, where, models.get(uid).label + ' ' + label);
          await closeMenu(models.get(uid).label + ' ' + label, where);
        }
      }
    });
    const leftovers = [...document.querySelectorAll('.jcontextmenu, .jss_contextmenu')].filter(menu => getComputedStyle(menu).display !== 'none').length;
    if (leftovers) fail(`${leftovers} menu(s) left open`);
  }

  // Insert or delete a row or column through the real right-click menu. The record is changed only
  // by what really happened (read back from the table), and the result is then compared strictly.
  async function structureOp(uid, forced) {
    const model = models.get(uid);
    if (model.plate) return;
    // A press outside the table (a save, the popup, the page) takes the EMPTY grey filler columns off on purpose; the record follows that rule here too,
    // before it picks a cell, or it would look for a cell in a column that is gone ("cell F2 not found for a menu action", seed 11, mixed round 6)
    if (model.fillerBase !== undefined) {
      const rootNow = api.overlayElement(uid);
      const liveCols = rootNow ? rootNow.querySelectorAll('.jss_worksheet thead td[data-x]').length : 0;
      if (liveCols >= model.fillerBase && liveCols < model.grid[0].length && model.grid.every(row => row.slice(liveCols).every(value => value === ''))) {
        model.grid.forEach(row => { row.length = liveCols; });
        note('record-follows-filler-cleanup');
      }
    }
    const rows = model.grid.length; const cols = model.grid[0].length;
    const kind = forced?.kind ?? pick(['row-after', 'row-before', 'col-after', 'col-before', 'del-row', 'del-col']);
    if ((kind === 'del-row' && rows <= 2) || (kind === 'del-col' && cols <= 2)) return;
    if ((kind.startsWith('row') && rows >= 14) || (kind.startsWith('col') && cols >= 10)) return;
    const r = forced?.r ?? int(0, rows - 1); const c = forced?.c ?? int(0, cols - 1);
    checkDesync(uid, `before menu-${kind}`);
    note(`menu-${kind}`);
    // Size of the stored table (it follows the live grid a moment after each change).
    const domSize = () => { const t = tableEl(uid); return [t.rows.length - 1, t.rows[0].cells.length - 1]; };
    // The stored table follows the live grid a little later (a debounce, longer when the machine is busy): read the size it is going to have, not
    // the size it still has, or a step that was only waiting for the stored table to catch up an earlier change (a grey filler press) reads as
    // the menu action's own change ("size changed by 1 rows and 2 columns, expected 1 and 0" in one slow soak run).
    if (!config.noStoredWait) {
      const liveSize = () => { const r0 = api.overlayElement(uid); return r0 ? [r0.querySelectorAll('.jss_worksheet tbody tr').length, r0.querySelectorAll('.jss_worksheet thead td[data-x]').length] : null; };
      for (let i = 0; i < 80; i++) {
        const live0 = liveSize(); const now = domSize();
        if (!live0 || (live0[0] === now[0] && live0[1] === now[1])) break;
        if (i === 0) note('stored-table-behind-live-grid');
        await sleep(100);
      }
    }
    const sizeBefore = domSize();
    let clicked = false;
    await timed(`menu-${kind}`, async () => {
      const root = await live(uid);
      const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      if (!td) { fail(`cell ${cellName(r, c)} not found for a menu action`, { table: model.label }); return; }
      press(td);
      await sleep(150);
      const header = kind.includes('col') ? (root.querySelector(`.jss_worksheet thead td[data-x="${c}"]`) || td) : td;
      const hr = header.getBoundingClientRect();
      const rc = { bubbles: true, cancelable: true, view: window, clientX: hr.x + 10, clientY: hr.y + 8, button: 2, buttons: 2 };
      header.dispatchEvent(new PointerEvent('pointerdown', rc));
      header.dispatchEvent(new MouseEvent('mousedown', rc));
      header.dispatchEvent(new MouseEvent('mouseup', { ...rc, buttons: 0 }));
      header.dispatchEvent(new MouseEvent('contextmenu', rc));
      await sleep(300);
      const menu = openMenu();
      const pattern = {
        'row-after': /insert a new row after/i, 'row-before': /insert a new row before/i,
        'col-after': /insert a new column after/i, 'col-before': /insert a new column before/i,
        'del-row': /delete selected rows/i, 'del-col': /delete selected columns/i,
      }[kind];
      const item = menu && [...menu.querySelectorAll('a')].find(a => pattern.test(a.textContent));
      if (!item) { fail(`menu item ${pattern} not found`, { table: model.label, items: menu ? [...menu.querySelectorAll('a')].map(a => a.textContent.trim()).slice(0, 12) : 'no menu' }); await closeMenu(model.label, 'structure'); return; }
      clickMenuItem(item);
      clicked = true;
      await sleep(700);
    });
    if (!clicked) return;
    checkDesync(uid, `after menu-${kind}`);
    let sizeAfter = domSize();
    // the grid redraws a little after the menu click: wait for the expected change, up to 5 s
    const wanted = { 'row-after': [1, 0], 'row-before': [1, 0], 'col-after': [0, 1], 'col-before': [0, 1], 'del-row': [-1, 0], 'del-col': [0, -1] }[kind];
    for (let i = 0; i < 50 && (sizeAfter[0] - sizeBefore[0] !== wanted[0] || sizeAfter[1] - sizeBefore[1] !== wanted[1]); i++) { await sleep(100); sizeAfter = domSize(); }
    if (kind.startsWith('row')) await rowHeightsUniform(uid, kind);
    await sleep(600);
    await measure(`after ${kind}: the editor must fit the table without a click`);
    const blank = n => Array.from({ length: n }, () => '');
    const expect = { 'row-after': [1, 0], 'row-before': [1, 0], 'col-after': [0, 1], 'col-before': [0, 1], 'del-row': [-1, 0], 'del-col': [0, -1] }[kind];
    const dRows = sizeAfter[0] - sizeBefore[0]; const dCols = sizeAfter[1] - sizeBefore[1];
    if (dRows !== expect[0] || dCols !== expect[1]) {
      dataLoss.push({ context, table: model.label, problem: `${kind}: size changed by ${dRows} rows and ${dCols} columns, expected ${expect[0]} and ${expect[1]}` });
    }
    // The record follows what the table did, so one problem is reported once and not forever.
    if (dRows === 1) model.grid.splice(kind === 'row-before' ? r : r + 1, 0, blank(cols));
    else if (dRows === -1) model.grid.splice(r, 1);
    else if (dRows > 1) for (let i = 0; i < dRows; i++) model.grid.splice(r + 1, 0, blank(cols));
    else if (dRows < -1) model.grid.splice(r, -dRows);
    if (dCols !== 0) model.fillerBase = undefined; // a column the person inserts or deletes makes the added columns real (as in the app)
    if (dCols === 1) model.grid.forEach(row => row.splice(kind === 'col-before' ? c : c + 1, 0, ''));
    else if (dCols === -1) model.grid.forEach(row => row.splice(c, 1));
    else if (dCols > 1) model.grid.forEach(row => row.splice(c + 1, 0, ...blank(dCols)));
    else if (dCols < -1) model.grid.forEach(row => row.splice(c, -dCols));
  }

  // ---- consistency between the three copies: inline grid, popup, and the stored HTML -------
  const storedData = table => {
    try {
      const raw = table.getAttribute('data-spreadsheet');
      const json = JSON.parse(decodeURIComponent(escape(atob(raw))));
      return (json.data || []).map(row => row.map(v => (v == null ? '' : String(v))));
    } catch (error) { return null; }
  };
  const domCells = root => {
    const out = [];
    root.querySelectorAll('.jss_worksheet tbody tr').forEach((tr, r) => {
      out[r] = [];
      tr.querySelectorAll('td[data-x]').forEach(td => { out[r][Number(td.dataset.x)] = (td.textContent || '').trim(); });
    });
    return out;
  };
  const sameGrid = (a, b) => JSON.stringify(trim(a)) === JSON.stringify(trim(b));
  // For what is shown on screen: a formula cell shows its result, so cells whose recorded value is a
  // formula are left out of the comparison.
  const sameShown = (shown, model) => {
    const mask = grid => grid.map((row, r) => row.map((v, c) => (String(model[r]?.[c] ?? '').startsWith('=') ? '' : v)));
    return sameGrid(mask(shown), mask(model));
  };
  async function consistency(label, withPopup) {
    context = label;
    await sleep(config.settleMs);
    note('consistency');
    for (const [uid, model] of models) {
      const table = tableEl(uid);
      if (!table) continue;
      const stored = storedData(table);
      if (!stored) fail('stored data in the HTML (data-spreadsheet) is unreadable', { table: model.label });
      else if (!sameGrid(stored, model.grid) && !model.plate) dataLoss.push({ context, table: model.label, where: 'stored HTML (data-spreadsheet)', problem: 'differs from what was entered', have: JSON.stringify(trim(stored)).slice(0, 160) });
      else if (model.plate && !sameGrid(stored.slice(0, model.grid.length).map(r => r.slice(0, model.grid[0].length)), model.grid)) dataLoss.push({ context, table: model.label, where: 'stored HTML (data-spreadsheet)', problem: 'differs from what was entered' });
      const shown = extractShown(table);
      if (shown && !sameShown(shown, model.grid)) dataLoss.push({ context, table: model.label, where: 'visible table cells', problem: 'differ from what was entered' });
      if (withPopup) {
        let root = await live(uid);
        // a grid that does not come up is a finding of its own, not a reason to stop the whole run
        for (let attempt = 0; attempt < 3 && !root; attempt++) { await sleep(600); root = await live(uid); }
        if (!root) { fail('the inline grid did not come up (no live overlay) when it was scrolled into view', { table: model.label }); continue; }
        const inline = domCells(root);
        if (!sameShown(inline, model.grid)) dataLoss.push({ context, table: model.label, where: 'inline grid cells on screen', problem: 'differ from what was entered' });
        const button = root.querySelector('.elabftw-spreadsheet-readonly-open-editor');
        if (button) {
          button.click();
          let dialog = null;
          for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
          if (!dialog) { fail('popup did not open for the consistency check', { table: model.label }); continue; }
          await sleep(500);
          const inPopup = domCells(dialog);
          if (!sameShown(inPopup, model.grid)) dataLoss.push({ context, table: model.label, where: 'popup', problem: 'popup shows different data than the inline grid / stored table' });
          const cancel = [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()));
          cancel?.click();
          for (let i = 0; i < 60 && document.querySelector('.inline-spreadsheet-dialog'); i++) await sleep(50);
        }
      }
    }
  }
  // The text of the real table cells in the editor (without its header row and column).
  function extractShown(table) {
    return Array.from(table.rows).slice(1).map(tr => Array.from(tr.cells).slice(1).map(td => (td.textContent || '').trim()));
  }

  // ---- scrolling without jiggle ---------------------------------------------------------
  // Scroll down and up in small steps; at every stop each spreadsheet's grid must sit exactly on its
  // table (no drift), the editor must keep its height, and tables must keep their place in the text.
  async function scrollCheck(label) {
    context = label;
    // grids are placed and the editor resized by a loop that only runs while the page is drawn
    if (document.hidden) { note('scroll-check-skipped-hidden'); return; }
    note('scroll-check');
    const iframe = editor.getContainer().querySelector('iframe');
    const doc = editor.getDoc();
    const stops = [];
    const height = () => document.documentElement.scrollHeight;
    const start = window.scrollY;
    const positions = () => Array.from(doc.querySelectorAll('table.elabftw-spreadsheet')).map(t => Math.round(t.getBoundingClientRect().top + doc.defaultView.scrollY));
    // The editor may still be settling after the last step. Watch it for a moment without scrolling, so that a change
    // that comes by itself is not reported as caused by scrolling (the two have different causes).
    {
      const frameAt = () => Math.round(iframe.getBoundingClientRect().height);
      const first = { frame: frameAt(), page: height() };
      let lastChange = Date.now(); let seen = { ...first };
      for (let i = 0; i < 12 && Date.now() - lastChange < 700; i++) {
        await sleep(200);
        const now = { frame: frameAt(), page: height() };
        if (now.frame !== seen.frame || now.page !== seen.page) { seen = now; lastChange = Date.now(); }
      }
      if (Math.abs(seen.frame - first.frame) > 2 || Math.abs(seen.page - first.page) > 4) {
        if (sizes.problems.length < 40) sizes.problems.push({ context: `${label} (settling)`, problem: `editor height changed by itself, without scrolling, from ${first.frame} to ${seen.frame} px after the last step` });
        scrollJiggles++;
      }
    }
    const baseline = positions();
    // what each table looks like (its own height, the live grid on top of it, a plate or not), to say which one changed
    const tableStates = () => Array.from(doc.querySelectorAll('table.elabftw-spreadsheet')).map(table => {
      const uid = table.getAttribute('data-elabftw-spreadsheet-uid');
      const overlay = uid ? api.overlayElement(uid) : null;
      const parts = overlay ? [...overlay.children].map(child => `${String(child.className).replace('elabftw-spreadsheet-', '').slice(0, 26)}:${Math.round(child.getBoundingClientRect().height)}`).join(' ') : '';
      const rowsHeights = overlay ? [...overlay.querySelectorAll('.jss_worksheet > tbody > tr')].map(tr => `${Math.round(tr.getBoundingClientRect().height)}${tr.querySelector('.jss-cell-clip') ? 'c' : ''}`).join(',') : '';
      return { h: Math.round(table.getBoundingClientRect().height), o: overlay ? Math.round(overlay.getBoundingClientRect().height) : null, plate: !!(overlay && overlay.classList.contains('elabftw-well-plate-view')), top: Math.round(table.getBoundingClientRect().top + doc.defaultView.scrollY), parts, rowsHeights };
    });
    const stateBase = tableStates();
    const describeChanges = () => {
      const now = tableStates();
      const out = [];
      now.forEach((state, i) => {
        const was = stateBase[i];
        if (!was) { out.push(`table ${i + 1} is new`); return; }
        const parts = [];
        if (state.h !== was.h) parts.push(`height ${was.h}->${state.h}`);
        if (state.o !== was.o) parts.push(`grid ${was.o === null ? 'not mounted' : was.o}->${state.o === null ? 'not mounted' : state.o}${was.parts || state.parts ? ` [${was.parts || '-'}] -> [${state.parts || '-'}]` : ''}${was.rowsHeights || state.rowsHeights ? ` rows(${was.rowsHeights || '-'}) -> rows(${state.rowsHeights || '-'})` : ''}`);
        if (state.top !== was.top) parts.push(`top ${was.top}->${state.top}`);
        if (parts.length) out.push(`table ${i + 1}${state.plate || was.plate ? ' (plate)' : ''}: ${parts.join(', ')}`);
      });
      return out.slice(0, 5).join('; ') || 'no table changed';
    };
    const frameBase = Math.round(iframe.getBoundingClientRect().height);
    const heightBase = height();
    const path = [];
    for (let y = 0; y <= Math.min(heightBase, 3000); y += 240) path.push(y);
    const reversed = path.slice().reverse();
    await timed('scroll-pass', async () => {
      for (const y of [...path, ...reversed]) {
        window.scrollTo(0, y);
        await frames(3);
        await sleep(60);
        const tables = Array.from(doc.querySelectorAll('table.elabftw-spreadsheet'));
        const frameRect = iframe.getBoundingClientRect();
        tables.forEach((table, i) => {
          const uid = table.getAttribute('data-elabftw-spreadsheet-uid');
          const overlay = uid ? api.overlayElement(uid) : null;
          if (!overlay) return;
          const t = table.getBoundingClientRect();
          const o = overlay.getBoundingClientRect();
          if (o.width === 0 || o.height === 0) return;
          const dx = Math.abs(o.left - (frameRect.left + t.left));
          const dy = Math.abs(o.top - (frameRect.top + t.top));
          if (dx > 3 || dy > 3) stops.push({ y, table: i + 1, drift: `${Math.round(dx)}px across, ${Math.round(dy)}px down` });
        });
        const frame = Math.round(iframe.getBoundingClientRect().height);
        if (Math.abs(frame - frameBase) > 2) stops.push({ y, problem: `editor height changed from ${frameBase} to ${frame} px while scrolling (at ${y}; ${describeChanges()})` });
        const hNow = height();
        if (Math.abs(hNow - heightBase) > 4) stops.push({ y, problem: `page height changed from ${heightBase} to ${hNow} px while scrolling` });
      }
    });
    const after = positions();
    if (after.length !== baseline.length || after.some((v, i) => Math.abs(v - baseline[i]) > 3)) stops.push({ problem: `tables moved inside the text: ${JSON.stringify(baseline)} to ${JSON.stringify(after)}` });
    window.scrollTo(0, start);
    stops.slice(0, 6).forEach(stop => { if (sizes.problems.length < 40) sizes.problems.push({ context: `${label} (scrolling)`, problem: stop.problem || `grid ${stop.drift} off its table at scroll ${stop.y} (table ${stop.table})` }); });
    scrollJiggles += stops.length;
  }

  // Select several rows or columns (click the first, shift-click the last) and delete them at once.
  async function multiDelete(uid) {
    const model = models.get(uid);
    if (model.plate) return;
    const byRow = random() < 0.5;
    const size = byRow ? model.grid.length : model.grid[0].length;
    if (size < 5) return;
    const count = int(2, Math.min(3, size - 2));
    const first = int(0, size - count);
    const lastIdx = first + count - 1;
    note(byRow ? 'multi-delete-rows' : 'multi-delete-columns');
    await measure('before multi-delete');
    const before = { frame: lastSize.frame, content: lastSize.content };
    let doneMulti = false;
    await timed(byRow ? 'multi-delete-rows' : 'multi-delete-columns', async () => {
      const root = await live(uid);
      const cellAt = (r, c) => root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      const press = (el, extra = {}) => {
        const rect = el.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1, ...extra };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        el.dispatchEvent(new MouseEvent('mousedown', init));
        el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
      };
      const from = byRow ? cellAt(first, 0) : cellAt(0, first);
      const to = byRow ? cellAt(lastIdx, model.grid[0].length - 1) : cellAt(model.grid.length - 1, lastIdx);
      press(from); await sleep(150);
      press(to, { shiftKey: true }); await sleep(250);
      const target = byRow ? cellAt(lastIdx, 0) : root.querySelector(`.jss_worksheet thead td[data-x="${lastIdx}"]`) || cellAt(0, lastIdx);
      const rect = target.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + 12, clientY: rect.y + 8, button: 2, buttons: 2 };
      target.dispatchEvent(new MouseEvent('contextmenu', init));
      await sleep(300);
      const menu = openMenu();
      const item = menu && [...menu.querySelectorAll('a')].find(a => (byRow ? /delete selected rows/i : /delete selected columns/i).test(a.textContent));
      if (!item) {
        const seen = [...document.querySelectorAll('.jcontextmenu, .jss_contextmenu')].map(m => ({ display: getComputedStyle(m).display, width: Math.round(m.getBoundingClientRect().width), items: [...m.querySelectorAll('a')].map(a => a.textContent.trim()).slice(0, 6) }));
        fail('multi-delete menu item not found', { table: model.label, byRow, highlighted: root.querySelectorAll('td.highlight').length, menus: seen, rescueOpen: !!visibleRescue(), active: (document.activeElement?.className || document.activeElement?.tagName || '').toString().slice(0, 40) });
        await closeMenu(model.label, 'multi-delete'); return;
      }
      clickMenuItem(item);
      await sleep(700);
      doneMulti = true;
    });
    if (!doneMulti) return;
    // What really happened is read from the cells of the live grid (every row and column, nothing trimmed): a
    // multi-delete must remove whole rows or columns, in one block, and nothing else may change.
    const nowGrid = domCells(await live(uid));
    const size2 = byRow ? model.grid.length : model.grid[0].length;
    // A formula in the record shows its result in the grid (=A1+1 as 861), so formula cells match whatever is shown.
    const exact = (x, y) => x.length === y.length && x.every((row, r) => row.length === y[r].length && row.every((v, c) => String(v ?? '').startsWith('=') || v === y[r][c]));
    const without = (a1, b1) => (byRow ? model.grid.filter((_, i) => i < a1 || i > b1) : model.grid.map(row => row.filter((_, i) => i < a1 || i > b1)));
    const normalizedNow = nowGrid.map(row => Array.from(row, v => v ?? ''));
    // The block that was selected is tried first: formula cells match anything, and on a mostly empty table
    // an earlier block can look the same, which used to make the record keep a formula that was really deleted.
    let matched = exact(without(first, lastIdx), normalizedNow) ? [first, lastIdx] : null;
    for (let a1 = 0; a1 < size2 && !matched; a1++) for (let b1 = a1; b1 < size2 && !matched; b1++) {
      if (exact(without(a1, b1), normalizedNow)) matched = [a1, b1];
    }
    note('multi-delete-checked');
    if (matched) {
      if (matched[0] !== first || matched[1] !== lastIdx) note('multi-delete-different-range');
      model.grid = without(matched[0], matched[1]);
      if (!byRow) model.fillerBase = undefined;
    } else if (exact(model.grid, normalizedNow)) {
      note('multi-delete-nothing-happened'); // the menu action did not take effect; the record stays as it was
    } else {
      dataLoss.push({ context, table: model.label, problem: 'multi-delete left cells that are not the old ones minus a block of whole rows/columns', have: JSON.stringify(normalizedNow).slice(0, 200) });
      model.grid = normalizedNow.map(row => row.slice());
    }
    await measure('after multi-delete');
    if (lastSize.frame > before.frame + 4) sizes.problems.push({ context: 'after multi-delete', problem: `editor grew from ${before.frame} to ${lastSize.frame} px after deleting rows/columns` });
  }

  async function popupEdit(uid, apply, edits) {
    const model = models.get(uid);
    note(apply ? 'popup-apply' : 'popup-cancel');
    await timed(apply ? 'popup-apply' : 'popup-cancel', async () => {
      const root = await live(uid);
      const button = root.querySelector('.elabftw-spreadsheet-readonly-open-editor');
      if (!button) throw new Error('open-editor button not found');
      button.click();
      let dialog = null;
      for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
      if (!dialog) throw new Error('popup did not open');
      await sleep(400);
      const staged = [];
      for (let i = 0; i < edits; i++) {
        const r = int(0, model.grid.length - 1); const c = int(0, model.grid[0].length - 1); const value = `p${int(100, 999)}`;
        await editCell(dialog, r, c, value);
        staged.push([r, c, value]);
      }
      await measure('popup open');
      const pattern = apply ? /^(Update|Insert)/ : /^Cancel/;
      const target = [...dialog.querySelectorAll('button')].find(b => pattern.test(b.textContent.trim()));
      if (!target) throw new Error('popup button not found');
      target.click();
      for (let i = 0; i < 60 && document.querySelector('.inline-spreadsheet-dialog'); i++) await sleep(50);
      if (apply) staged.forEach(([r, c, value]) => { model.grid[r][c] = value; });
    });
    // pressing Update must not change how tall the rows are (the popup's own 34 px rows were once saved)
    if (apply) {
      await sleep(2000);
      await rowHeightsUniform(uid, 'the popup Update');
      const stored = (() => { try { return JSON.parse(decodeURIComponent(escape(atob(tableEl(uid).getAttribute('data-spreadsheet'))))).rowHeights; } catch (error) { return null; } })();
      if (stored && Object.values(stored).some(h => Math.round(Number(h)) === 34)) fail(`the popup Update saved the library default row height (34 px) as a chosen height: ${JSON.stringify(stored)}`, { table: model.label });
    }
  }

  async function save() {
    note('save');
    await timed('save', async () => { editor.execCommand('mceSave'); await sleep(1100); });
  }

  const addText = async (text, count = 1) => {
    layoutDirty = true;
    editor.selection.select(editor.getBody(), true);
    editor.selection.collapse(false);
    editor.insertContent(Array.from({ length: count }, (_, i) => `<p>${text} ${i + 1}</p>`).join(''));
    await sleep(250);
  };

  async function pasteCopy(uid, spaced) {
    const html = api.copyHtml(uid);
    if (!html) { fail('could not copy the spreadsheet'); return null; }
    if (spaced) await addText('Some notes between the two tables', 4);
    editor.selection.select(editor.getBody(), true);
    editor.selection.collapse(false);
    layoutDirty = true;
    const before = new Set(api.snapshot(false).map(snap => snap.uid));
    // through the editor's own paste filter (a plain insertContent would skip it): a copy of one of our own spreadsheets must keep its layout
    await timed('paste-table', async () => { editor.execCommand('mceInsertClipboardContent', false, { html }); await sleep(900); });
    note(spaced ? 'paste-spaced' : 'paste-right-after');
    const strippedCopies = [...editor.getBody().querySelectorAll('table.elabftw-pasted-table')].length;
    if (strippedCopies > 0) fail(`a pasted copy of a spreadsheet lost its column widths and table width (${strippedCopies} table(s) went through the other-application paste filter)`);
    const after = api.snapshot(true);
    const added = after.filter(snap => !before.has(snap.uid));
    if (added.length !== 1) {
      fail(`pasting one spreadsheet gave ${added.length} new ones (ids shared: ${after.length - new Set(after.map(s => s.uid)).size})`);
      // keep the record in step with what is there, so later checks stay meaningful
      return null;
    }
    const copyUid = added[0].uid;
    models.set(copyUid, { label: `${models.get(uid).label} (copy${spaced ? ', spaced' : ''})`, grid: models.get(uid).grid.map(row => row.slice()), plate: models.get(uid).plate });
    return copyUid;
  }

  // ---- formatting, popup closing and click-to-type -------------------------------------------
  const press = (el, extra = {}) => {
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1, ...extra };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  };
  const isBold = td => /bold|700/.test(td.style.fontWeight || getComputedStyle(td).fontWeight);
  const isItalic = td => /italic/.test(td.style.fontStyle || getComputedStyle(td).fontStyle);
  const alignOf = td => td.style.textAlign || getComputedStyle(td).textAlign;
  // The popup has a second "Align center" (and Align left/right/Justify) in its collapsed "Appearance" panel: that one sets the DEFAULT for new
  // cells, not the selected cell. The buttons of the selected cells are the ones outside that panel.
  const findButton = (root, labels) => [...root.querySelectorAll('button, [title], [aria-label]')]
    .find(b => !b.closest('.inline-spreadsheet-appearance') && (labels.includes(b.title) || labels.includes(b.getAttribute('aria-label'))));
  const openFormatBar = root => {
    const toggle = root.querySelector('.elabftw-spreadsheet-options-toggle');
    if (toggle && !root.querySelector('.elabftw-spreadsheet-format-bar')?.offsetParent) toggle.click();
  };
  async function openPopupFor(uid) {
    const root = await live(uid);
    const button = root.querySelector('.elabftw-spreadsheet-readonly-open-editor');
    if (!button) throw new Error('open-editor button not found');
    button.click();
    let dialog = null;
    for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
    if (!dialog) throw new Error('popup did not open');
    await sleep(450);
    return dialog;
  }
  const popupOpen = () => !!document.querySelector('.inline-spreadsheet-dialog');
  async function waitPopupGone() { for (let i = 0; i < 40 && popupOpen(); i++) await sleep(50); await sleep(500); }

  // Formatting buttons inline and in the popup; look must show on screen, survive the popup's
  // Update, and be written into the stored table.
  async function formatting(uid) {
    const model = models.get(uid);
    note('formatting');
    const savedLook = (r, c) => { const td = tableEl(uid).rows[r + 1]?.cells[c + 1]; return td ? { bold: /bold|700/.test(td.style.fontWeight), italic: /italic/.test(td.style.fontStyle), align: td.style.textAlign } : null; };
    await timed('formatting', async () => {
      let root = await live(uid);
      openFormatBar(root); await sleep(450);
      const steps = [
        { r: 0, c: 0, label: ['Bold'], ok: td => isBold(td), what: 'bold' },
        { r: 0, c: 1, label: ['Italic'], ok: td => isItalic(td), what: 'italic' },
        { r: 1, c: 0, label: ['Align right'], ok: td => alignOf(td) === 'right', what: 'align right' },
      ];
      for (const step of steps) {
        root = await live(uid);
        press(root.querySelector(`td[data-x="${step.c}"][data-y="${step.r}"]`)); await sleep(200);
        const button = findButton(root, step.label);
        if (!button) { fail(`inline "${step.label[0]}" button not found`, { table: model.label }); continue; }
        button.click(); await sleep(400);
        root = await live(uid);
        if (!step.ok(root.querySelector(`td[data-x="${step.c}"][data-y="${step.r}"]`))) fail(`inline ${step.what} did not show on the cell`, { table: model.label });
      }
      await sleep(config.settleMs);
      const s0 = savedLook(0, 0); const s1 = savedLook(0, 1); const s2 = savedLook(1, 0);
      if (!s0?.bold) dataLoss.push({ context, table: model.label, where: 'stored table', problem: 'bold formatting not saved' });
      if (!s1?.italic) dataLoss.push({ context, table: model.label, where: 'stored table', problem: 'italic formatting not saved' });
      if (s2?.align !== 'right') dataLoss.push({ context, table: model.label, where: 'stored table', problem: 'right alignment not saved' });
      // the same buttons in the popup
      const dialog = await openPopupFor(uid);
      const popupSteps = [
        { r: 1, c: 1, label: ['Bold', 'Bold selected cells'], ok: td => isBold(td), what: 'bold' },
        { r: 2, c: 0, label: ['Italic', 'Italicize selected cells'], ok: td => isItalic(td), what: 'italic' },
        { r: 2, c: 1, label: ['Align center'], ok: td => alignOf(td) === 'center', what: 'align center' },
      ];
      openFormatBar(dialog);
      for (const step of popupSteps) {
        const td = dialog.querySelector(`td[data-x="${step.c}"][data-y="${step.r}"]`);
        if (!td) continue;
        press(td); await sleep(200);
        const button = findButton(dialog, step.label);
        if (!button) { fail(`popup "${step.label[0]}" button not found`, { table: model.label }); continue; }
        button.click(); await sleep(400);
        if (!step.ok(dialog.querySelector(`td[data-x="${step.c}"][data-y="${step.r}"]`))) fail(`popup ${step.what} did not show on the cell`, { table: model.label });
      }
      [...dialog.querySelectorAll('button')].find(b => /^Update/.test(b.textContent.trim()))?.click();
      await waitPopupGone();
      root = await live(uid);
      if (!isBold(root.querySelector('td[data-x="1"][data-y="1"]'))) dataLoss.push({ context, table: model.label, where: 'inline grid', problem: 'bold set in the popup was lost after Update' });
      await sleep(config.settleMs);
      if (!savedLook(1, 1)?.bold) dataLoss.push({ context, table: model.label, where: 'stored table', problem: 'bold set in the popup not saved' });
      if (!isBold(root.querySelector('td[data-x="0"][data-y="0"]'))) dataLoss.push({ context, table: model.label, where: 'inline grid', problem: 'inline bold lost after the popup was used' });
    });
  }

  // Closing the popup without saving must never delete, empty or move the table.
  async function popupClosing(uid) {
    const model = models.get(uid);
    note('popup-closing');
    const countBefore = api.snapshot(false).length;
    for (const how of ['Cancel button', 'close (X) button', 'Escape key', 'click outside']) {
      await timed('popup-close', async () => {
        const dialog = await openPopupFor(uid);
        const r = int(0, model.grid.length - 1); const c = int(0, model.grid[0].length - 1);
        await editCell(dialog, r, c, `unsaved-${int(100, 999)}`); // typed but never applied
        if (how === 'Cancel button') [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
        else if (how === 'close (X) button') {
          const x = [...dialog.querySelectorAll('button, [role=button], .close')].find(b => /^(close|×|✕|x)$/i.test((b.getAttribute('aria-label') || b.title || b.textContent || '').trim()));
          if (x) x.click(); else { note('popup-no-x-button'); [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click(); }
        } else if (how === 'Escape key') {
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        } else {
          const backdrop = document.elementFromPoint(4, 4);
          if (backdrop && !dialog.contains(backdrop)) press(backdrop);
        }
        await waitPopupGone();
        if (popupOpen()) { // closed some other way if this one does not close it: not a data problem
          [...document.querySelector('.inline-spreadsheet-dialog').querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
          await waitPopupGone();
          note(`popup-did-not-close-by-${how.replace(/\W+/g, '-')}`);
        }
      });
      if (!tableEl(uid)) dataLoss.push({ context, table: model.label, problem: `table deleted by closing the popup with the ${how}` });
      if (api.snapshot(false).length !== countBefore) dataLoss.push({ context, table: model.label, problem: `spreadsheet count changed after closing the popup with the ${how}` });
      await verify(`popup closed by ${how}`, true);
    }
  }

  // A click on a cell, then typing, starts editing at once (no double-click needed).
  async function clickToType(uid) {
    const model = models.get(uid);
    note('click-to-type');
    const root = await live(uid);
    for (let i = 0; i < 3; i++) {
      const r = int(0, model.grid.length - 1); const c = int(0, model.grid[0].length - 1);
      const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      press(td); await sleep(250);
      const key = String.fromCharCode(97 + int(0, 25));
      const target = document.activeElement || root;
      // one key press, to whatever has the keyboard, like a real one
      target.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true }));
      // wait for the cell editor to open (up to 2 s) and record how long it took
      let waited = 0; let box = null;
      while (waited < 2000 && !(box = visibleRescue())) { await sleep(50); waited += 50; }
      (timings['click-then-type-start'] ||= []).push(waited);
      const inCell = td.querySelector('input, textarea, [contenteditable=true]') || root.querySelector('.jss_editor input, .jss_editor textarea, td.editor');
      if (!box && !inCell) {
        fail(`clicking ${cellName(r, c)} and typing "${key}" did not start editing within 2 s`, { table: model.label });
        continue;
      }
      if (waited > 700) fail(`clicking ${cellName(r, c)} and typing "${key}" took ${waited} ms to start editing`, { table: model.label });
      // Escape goes to the cell editor that has the keyboard, as a real key press would.
      (box || document.activeElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await sleep(350);
    }
    await verify('click-to-type: nothing changed by starting and cancelling edits', true);
  }

  // Rows added by the Add rows button or the menu must be as tall as the others
  // (they were 4 px shorter once, because the row-number cell of a new row had no padding).
  async function rowHeightsUniform(uid, label) {
    const root = api.overlayElement(uid);
    if (!root || models.get(uid)?.tallRows) return; // a sheet of wrapped long text has rows of different heights on purpose
    await sleep(500);
    if (document.hidden) { note('row-height-check-skipped-hidden'); return; } // the layout loop is throttled then
    const trs = [...root.querySelectorAll('.jss_worksheet tbody tr')];
    const heights = trs.map(tr => Math.round(tr.getBoundingClientRect().height));
    // A row whose text wraps (a narrow column and a longer text, e.g. "#oligos in panel 21" in a 133 px column) is as high as its lines: that is the
    // rule (row-height-fits-text), not a difference. Only rows without wrapped text must have the same height.
    const wraps = tr => [...tr.querySelectorAll('td[data-x]')].some(td => {
      if (!td.textContent.trim()) return false;
      const range = document.createRange(); range.selectNodeContents(td);
      return new Set([...range.getClientRects()].map(rect => Math.round(rect.top / 4))).size > 1;
    });
    const plain = heights.filter((_, i) => !wraps(trs[i]));
    note('row-height-check');
    // rows with and without content can differ by 3 px in the table's own rendering
    if (plain.length && Math.max(...plain) - Math.min(...plain) > 4) {
      fail(`rows are not all the same height after ${label}: ${heights.join(' ')} (rows with wrapped text left out: ${heights.filter((_, i) => wraps(trs[i])).length})`, { table: models.get(uid)?.label });
    }
    // nothing may cover the last row: not the Add rows bar, not the horizontal scroll bar
    const rowsEls = root.querySelectorAll('.jss_worksheet tbody tr');
    const lastRow = rowsEls[rowsEls.length - 1];
    const bar = root.querySelector('.elabftw-spreadsheet-add-rows');
    const grid = root.querySelector('.elabftw-spreadsheet-readonly-grid');
    if (lastRow && grid) {
      const content = root.querySelector('.jss_content');
      const scrollbar = content ? content.offsetHeight - content.clientHeight : 0;
      const lastBottom = lastRow.getBoundingClientRect().bottom;
      const gridBottom = grid.getBoundingClientRect().bottom - Math.max(0, grid.offsetHeight - grid.clientHeight);
      if (lastBottom > gridBottom + 1) fail(`the last row is cut off at the bottom of the grid by ${Math.round(lastBottom - gridBottom)} px (${label})`, { table: models.get(uid)?.label });
      if (bar && lastBottom > bar.getBoundingClientRect().top + 1) fail(`the Add rows bar covers ${Math.round(lastBottom - bar.getBoundingClientRect().top)} px of the last row (${label})`, { table: models.get(uid)?.label });
    }
  }

  // The "number of rows + Add rows" bar under the grid.
  async function addRowsBar(uid, count) {
    const model = models.get(uid);
    if (model.plate) return;
    const root = await live(uid);
    const bar = root.querySelector('.elabftw-spreadsheet-add-rows');
    if (!bar) { fail('the Add rows bar is missing under the grid', { table: model.label }); return; }
    note('add-rows-bar');
    await timed('add-rows-bar', async () => {
      const input = bar.querySelector('input'); const button = bar.querySelector('button');
      input.value = String(count); input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await sleep(1400);
    });
    const room = 50 - model.grid.length;
    const added = Math.max(0, Math.min(count, room));
    for (let i = 0; i < added; i++) model.grid.push(Array.from({ length: model.grid[0].length }, () => ''));
    await rowHeightsUniform(uid, `Add rows (${count})`);
    await sleep(600);
    await measure(`after Add rows (${count}): the editor must fit the table without a click`);
  }

  // A well plate keeps its labels (1, 2, 3 across; A, B, C down) and its size: no Add rows bar, and Enter in the
  // last row adds nothing.
  const plateIsView = async uid => !!(await live(uid))?.classList.contains('elabftw-well-plate-view');
  const plateCheck = async (uid, context) => {
    const root = await live(uid);
    const model = models.get(uid);
    if (!root || !model) return;
    // Since 26 October a plate in the text is a compact plate view, not a grid: its labels are checked in the stored table.
    if (root.classList.contains('elabftw-well-plate-view')) {
      const stored = tableEl(uid);
      if (!stored) { fail(`${context}: the stored plate table is missing`); return; }
      const storedCols = [...stored.rows[0].cells].slice(1).map(el => el.textContent.trim());
      const storedRows = [...stored.rows].slice(1).map(row => row.cells[0].textContent.trim());
      if (storedCols.length === 0 || storedCols.some((text, i) => text !== String(i + 1))) fail(`${context}: the stored plate's column labels are not 1, 2, 3...`, { have: storedCols.slice(0, 6).join(',') });
      if (storedRows.length === 0 || storedRows.some((text, i) => text !== String.fromCharCode(65 + (i % 26)))) fail(`${context}: the stored plate's row labels are not A, B, C...`, { have: storedRows.slice(0, 6).join(',') });
      note('plate-view-checked');
      return;
    }
    // the labels (1, 2, 3 and A, B, C) are written on an animation frame, which a hidden page does not run
    if (document.hidden) { note('plate-check-skipped-hidden'); return; }
    await frames(3);
    const cols = [...root.querySelectorAll('.jss_worksheet > thead > tr > [data-x]')].map(el => el.textContent.trim());
    const rows = [...root.querySelectorAll('.jss_worksheet > tbody td.jss_row[data-y]')].map(el => el.textContent.trim());
    if (cols.length === 0 || cols.some((text, i) => text !== String(i + 1))) fail(`${context}: the plate's column headers are not 1, 2, 3...`, { have: cols.slice(0, 6).join(',') });
    if (rows.length === 0 || rows.some((text, i) => text !== String.fromCharCode(65 + (i % 26)))) fail(`${context}: the plate's row headers are not A, B, C...`, { have: rows.slice(0, 6).join(',') });
    if (root.querySelector('.elabftw-spreadsheet-add-rows')) fail(`${context}: a well plate shows the Add rows bar`);
  };

  // ---- scenarios ------------------------------------------------------------------------
  const pasteCopyWidths = async rich => {
      const original = await createTable('width source', { rows: 4, cols: 3 });
      if (!original) return;
      await typeInto(original, 0, 0, 'keep-me');
      // the typed value reaches the table's own cells when the sheet is saved, and the table is what a copy reads
      await save();
      // what the browser puts on the clipboard when the whole table is selected: the table as it stands in the editor
      const sourceTable = editor.getBody().querySelector(`table[data-elabftw-spreadsheet-uid="${original}"]`);
      if (!sourceTable) { fail('could not find the spreadsheet to copy'); return; }
      const copyTable = sourceTable.cloneNode(true);
      const wanted = [210, 64, 150];
      const gutter = copyTable.querySelector('.spreadsheet-coordinate') ? 1 : 0;
      const sourceCols = [...copyTable.querySelectorAll('colgroup > col')].slice(gutter);
      if (sourceCols.length !== wanted.length) { fail(`the copy has ${sourceCols.length} data columns, expected ${wanted.length}`); return; }
      sourceCols.forEach((col, i) => { col.style.width = `${wanted[i]}px`; });
      // a copy made by the editor carries the sizes in its saved data as well as in the <colgroup>; the rich copy is made so (the plain one keeps only
      // the <colgroup> changed, which the sheet handler has to honour too)
      if (rich) {
        try {
          const payload = JSON.parse(atob(copyTable.getAttribute('data-spreadsheet')));
          payload.colWidths = { 0: wanted[0], 1: wanted[1], 2: wanted[2] };
          copyTable.setAttribute('data-spreadsheet', btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
        } catch { /* the payload could not be read: the <colgroup> alone is tried */ }
      }
      // plain: without the editor's own rich-selection marker (a copy of the table from the toolbar menu);
      // rich: wrapped in it, as the editor's Ctrl+C writes a selection, which TinyMCE (not the sheet handler) pastes
      const bare = copyTable.outerHTML.replace(/\sdata-elabftw-rich-selection(="[^"]*")?/g, '');
      const html = rich ? `<div data-elabftw-rich-selection="true">${bare}</div>` : `<html><body>${bare}</body></html>`;
      layoutDirty = true;
      const before = new Set(api.snapshot(false).map(snap => snap.uid));
      editor.selection.select(editor.getBody(), true); editor.selection.collapse(false);
      const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'keep-me\t\t\n\t\t');
      editor.getDoc().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(1200);
      const added = api.snapshot(true).filter(snap => !before.has(snap.uid));
      if (added.length !== 1) { fail(`pasting a copy made ${added.length} spreadsheets, expected 1`); return; }
      const uid = added[0].uid;
      const pasted = editor.getBody().querySelector(`table[data-elabftw-spreadsheet-uid="${uid}"]`);
      let pastedGrid = models.get(original).grid.map(r => r.slice());
      try { pastedGrid = JSON.parse(atob(pasted.getAttribute('data-spreadsheet'))).data; } catch { /* the model of the original is the fallback */ }
      if (String(pastedGrid[0]?.[0]) !== 'keep-me') fail(`a pasted copy lost its cell contents (first cell is "${pastedGrid[0]?.[0]}")`);
      models.set(uid, { label: 'width copy', grid: pastedGrid, plate: false });
      const got = pasted ? [...pasted.querySelectorAll('colgroup > col')].slice(gutter).map(col => Math.round(Number.parseFloat(col.style.width))) : [];
      if (got.join(',') !== wanted.join(',')) fail(`a pasted copy has column widths ${got.join(', ')}, the source had ${wanted.join(', ')}`);
      await live(uid);
      await consistency('paste-copy-widths: inline, popup and stored HTML agree', true);
      await save();
  };

  // ---- text columns, preview versus live grid (the screenshot of three sheets in a narrow column) ------------------------------
  const LONG_TEXT = ['HEK293T sGFP-mCherry', 'HEK293T antiCD19-mCherry', 'HEK293T w endoAGPR-mCherry'];
  // The preview a reload would show is built from the stored table, put out of sight to be measured, then removed
  const withPreview = async (uid, fn) => {
    const host = api.buildPreview(uid);
    if (!host) return null;
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '1000px' });
    document.body.appendChild(host);
    await sleep(100);
    try { return fn(host); } finally { host.remove(); }
  };
  const sheetMetrics = (uid, usePreview = false, given = null) => {
    const root = given || (usePreview ? null : api.overlayElement(uid));
    const ws = root && root.querySelector('.jss_worksheet');
    if (!ws) return null;
    const cols = [...ws.querySelectorAll('thead td[data-x]')].map(td => Math.round(td.getBoundingClientRect().width));
    const rows = [...ws.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height));
    const cells = [...ws.querySelectorAll('tbody td[data-x][data-y]')].filter(td => td.textContent.trim() !== '');
    const aligns = [...new Set(cells.map(td => getComputedStyle(td).textAlign))];
    const clipped = cells.filter(td => td.scrollWidth > td.clientWidth + 1).map(td => `${td.dataset.x},${td.dataset.y}`);
    const box = ws.getBoundingClientRect();
    const table = tableEl(uid);
    const next = table && (table.closest('.elabftw-table-indent') || table).nextElementSibling;
    const nextTop = next ? Math.round(next.getBoundingClientRect().top + window.scrollY) : null;
    return { cols, rows, aligns, clipped, width: Math.round(box.width), height: Math.round(box.height), nextTop, dataCols: cols.length, dataRows: rows.length, textCells: cells.length };
  };
  const newTablesSince = before => api.snapshot(true).filter(snap => !before.has(snap.uid));
  const pasteHtmlOrText = async (html, text) => {
    editor.selection.select(editor.getBody(), true); editor.selection.collapse(false);
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    dt.setData('text/plain', text);
    editor.getDoc().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(1300);
  };
  // Makes a sheet of the long texts in one of the ways a person gets one; returns { uid, label, rows } or null.
  const makeTextSheet = async way => {
    layoutDirty = true;
    const rows = LONG_TEXT.map((text, i) => [text, String(i + 1)]);
    const before = new Set(api.snapshot(false).map(snap => snap.uid));
    if (way === 'typing') {
      const uid = await createTable('text column (typed)', { rows: 3, cols: 2 });
      if (!uid) return null;
      for (let r = 0; r < 3; r++) await typeInto(uid, r, 0, rows[r][0], 'Enter');
      await verify('text sheet typed', true);
      return { uid, label: 'typed', rows };
    }
    if (way === 'external-html') {
      await pasteHtmlOrText(`<table><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`, rows.map(r => r.join('\t')).join('\n'));
    } else if (way === 'plain-text') {
      await pasteHtmlOrText('', rows.map(r => r.join('\t')).join('\n'));
    } else if (way === 'command') {
      editor.focus();
      editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: 3, cols: 2, kind: 'standard', caption: '' });
      await sleep(1000);
    }
    const added = newTablesSince(before);
    if (added.length !== 1) { fail(`text sheet by ${way}: ${added.length} spreadsheets were made, expected 1`); return null; }
    models.set(added[0].uid, { label: `text column (${way})`, grid: rows.map(r => r.slice()), plate: false });
    return { uid: added[0].uid, label: way, rows };
  };

  const scenarios = {
    async 'plate-day'() {
      const uid = await createTable('96-well plate', { plate: 96 });
      if (!uid) return;
      await verify('plate-day: inserted', true); await measure('plate-day: inserted');
      await plateCheck(uid, 'plate-day: inserted');
      // the steps below type into a grid, which a plate in the text no longer is (see plateCheck)
      if (await plateIsView(uid)) { note('plate-view: grid steps skipped'); await save(); await verify('plate-day: saved', true); await measure('plate-day: saved'); return; }
      for (let i = 0; i < (config.quick ? 8 : 20); i++) {
        await typeInto(uid, int(0, 7), int(0, 11), `S${String(i + 1).padStart(2, '0')}`);
        if (i % 6 === 5) { await verify(`plate-day: ${i + 1} wells`, false); await measure('plate-day typing'); }
      }
      await popupEdit(uid, true, 3);
      await verify('plate-day: popup applied', true);
      await plateCheck(uid, 'plate-day: popup applied');
      await consistency('plate-day: inline, popup and stored HTML agree', true);
      await menuTour(uid);
      await scrollCheck('plate-day');
      await save();
      await verify('plate-day: saved', true); await measure('plate-day: saved');
    },
    async 'back-to-back'() {
      const made = [];
      for (const [rows, cols] of [[4, 4], [6, 5], [8, 3]]) {
        const uid = await createTable(`row ${made.length + 1} of three (${rows}x${cols})`, { rows, cols });
        if (uid) made.push(uid);
        await measure('back-to-back: insert');
      }
      await verify('back-to-back: inserted', true);
      for (let round = 0; round < 3; round++) {
        for (const uid of made) await typeInto(uid, int(0, models.get(uid).grid.length - 1), int(0, models.get(uid).grid[0].length - 1), `${models.get(uid).label.slice(0, 3)}${round}${int(10, 99)}`);
        await verify(`back-to-back: round ${round + 1}`, false);
        await measure('back-to-back: typing');
      }
      dumpSavedHeights('back-to-back: after typing');
      for (const uid of made) await menuTour(uid);
      dumpSavedHeights('back-to-back: after the menu tour');
      await scrollCheck('back-to-back');
      await popupEdit(made[1], true, 2);
      await verify('back-to-back: popup applied', true);
      await consistency('back-to-back: inline, popup and stored HTML agree', true);
      await save();
      await verify('back-to-back: saved', true); await measure('back-to-back: saved');
    },
    async 'spaced-out'() {
      const made = [];
      for (let i = 0; i < 4; i++) {
        await addText(`Step ${i + 1} of the protocol: notes and observations`, int(2, 6));
        const uid = await createTable(`spaced table ${i + 1}`, { rows: int(3, 7), cols: int(3, 6) });
        if (uid) made.push(uid);
        await measure('spaced-out: insert');
      }
      await verify('spaced-out: inserted', true);
      for (const uid of [...made, ...made.slice().reverse()]) {
        const model = models.get(uid);
        await typeInto(uid, int(0, model.grid.length - 1), int(0, model.grid[0].length - 1), `v${int(100, 999)}`);
        window.scrollTo(0, int(0, 400));
        await sleep(int(100, 500));
      }
      await verify('spaced-out: edited top to bottom and back', false);
      for (const uid of made) await structureOp(uid);
      for (const uid of made) await multiDelete(uid);
      await verify('spaced-out: rows and columns changed', true);
      await consistency('spaced-out: inline, popup and stored HTML agree', true);
      await menuTour(made[made.length - 1]);
      await scrollCheck('spaced-out');
      await save();
      await verify('spaced-out: saved', true); await measure('spaced-out: saved');
    },
    async 'copy-paste'() {
      const original = await createTable('original', { rows: 5, cols: 4 });
      if (!original) return;
      await typeInto(original, 0, 0, 'keep-me'); await typeInto(original, 4, 3, 'and-me');
      await verify('copy-paste: original filled', true);
      const right = await pasteCopy(original, false);
      await measure('copy-paste: pasted right after');
      const far = await pasteCopy(original, true);
      await measure('copy-paste: pasted further down');
      await verify('copy-paste: both pasted', true);
      if (right) { await typeInto(right, 2, 1, 'only-in-copy-1'); }
      if (far) { await typeInto(far, 1, 2, 'only-in-copy-2'); }
      await typeInto(original, 2, 2, 'only-in-original');
      await verify('copy-paste: each edited alone (no leaking between them)', true);
      await consistency('copy-paste: inline, popup and stored HTML agree', true);
      for (const uid of [original, right, far].filter(Boolean)) await menuTour(uid);
      await save();
      await verify('copy-paste: saved', true); await measure('copy-paste: saved');
    },
    async 'wide-plate'() {
      const uid = await createTable('384-well plate', { plate: 384 });
      if (!uid) return;
      await measure('wide-plate: inserted');
      await verify('wide-plate: inserted', true);
      await plateCheck(uid, 'wide-plate: inserted');
      if (await plateIsView(uid)) { note('plate-view: grid steps skipped'); await save(); await verify('wide-plate: saved', true); await measure('wide-plate: saved'); return; }
      for (const [r, c] of [[0, 0], [15, 23], [0, 23], [15, 0], [7, 11]]) await typeInto(uid, r, c, `W${r}-${c}`);
      await measure('wide-plate: typing');
      await verify('wide-plate: corners filled', true);
      await menuTour(uid);
      await plateCheck(uid, 'wide-plate: after menus');
      await scrollCheck('wide-plate');
      await measure('wide-plate: after menus');
      await save();
      await verify('wide-plate: saved', true); await measure('wide-plate: saved');
    },
    // Enter in the last row never adds a row (the first Enter commits and stays, a second one stays too); typed values
    // must survive that, and survive a row/column insert or delete done right after typing (before the grid has been
    // redrawn). Data was lost here once: values typed through the editor box exist only in the editor's own copy until a redraw.
    async 'enter-last-row'() {
      const uid = await createTable('enter table', { rows: 3, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      const rowsLive = async () => (api.overlayElement(uid) || await live(uid)).querySelectorAll('.jss_worksheet tbody tr').length;
      for (let i = 0; i < 10; i++) {
        const last = model().grid.length - 1;
        await typeInto(uid, last, int(0, model().grid[0].length - 1), `E${i + 1}`, 'Enter');
        await enterAgain(uid); // the second Enter, on the last row, stays: no row is added
        if (await rowsLive() !== model().grid.length) dataLoss.push({ context, table: model().label, problem: `Enter ${i + 1} in the last row changed the number of rows to ${await rowsLive()}, expected ${model().grid.length}` });
        await verify(`enter-last-row: Enter ${i + 1}, right after typing`, false);
        if (i % 3 === 2) { await typeInto(uid, int(0, model().grid.length - 1), int(0, model().grid[0].length - 1), `T${i}`); }
      }
      await verify('enter-last-row: all Enter rows', true);
      await rowHeightsUniform(uid, 'Enter in the last row');
      await addRowsBar(uid, int(1, 4));
      await verify('enter-last-row: after Add rows', true);
      await addRowsBar(uid, 2);
      await typeInto(uid, model().grid.length - 1, 0, 'in-new-row');
      await verify('enter-last-row: typed in a row made by Add rows', true);
      measure('enter-last-row: grown');
      // typed values, then at once a row/column change
      for (let i = 0; i < 6; i++) {
        await typeInto(uid, int(0, model().grid.length - 1), int(0, model().grid[0].length - 1), `S${i + 1}`);
        await structureOp(uid);
        await verify(`enter-last-row: type then row/column change ${i + 1}`, false);
      }
      // and Enter in the last row followed at once by a popup
      await typeInto(uid, model().grid.length - 1, 0, 'LBP', 'Enter');
      await enterAgain(uid);
      await popupEdit(uid, true, 2);
      await verify('enter-last-row: popup after Enter', true);
      await consistency('enter-last-row: inline, popup and stored HTML agree', true);
      await save();
      await verify('enter-last-row: saved', true);
    },
    // Text around a date: a header put under an inserted date must not bring an empty line with it.
    // (Reported by the owner: "an empty line is inserted" when adding a header under a date.)
    async 'date-then-header'() {
      const body = () => editor.getBody();
      const kinds = () => Array.from(body().children).map(el => {
        const text = (el.textContent || '').replace(/[​\s]/g, '');
        if (/^H[1-6]$/.test(el.tagName)) return el.querySelector('.elabftw-date-reference') ? 'DATE' : el.tagName;
        if (el.tagName === 'P') return text === '' && !el.querySelector('img,table') ? 'EMPTY' : 'P';
        return el.tagName;
      });
      const dateButton = () => [...document.querySelectorAll('.tox-split-button')].find(b => /Insert today/i.test(b.getAttribute('aria-label') || ''));
      const titleButton = () => [...document.querySelectorAll('.tox-split-button')].find(b => /Insert title/i.test(b.getAttribute('aria-label') || ''));
      const insertDate = async () => { dateButton().firstElementChild.click(); await sleep(450); };
      const expectKinds = (label, expected) => {
        const have = kinds();
        note(`header-${label}`);
        if (JSON.stringify(have) !== JSON.stringify(expected)) fail(`header under a date (${label}): expected ${expected.join(' ')} but found ${have.join(' ')}`, { html: body().innerHTML.replace(/<a class="elabftw-date-reference"[\s\S]*?<\/a>/g, '[date]').slice(0, 300) });
      };
      // This scenario needs a clean page, so what is on it is put aside and put back at the end.
      const savedContent = editor.getContent();
      layoutDirty = true;
      const fresh = async html => { editor.setContent(html); editor.focus(); editor.selection.select(editor.getBody(), true); editor.selection.collapse(false); await sleep(250); };

      // 1. empty page: date, then the paragraph that follows becomes a Heading 2
      await fresh('');
      await insertDate();
      editor.execCommand('mceToggleFormat', false, 'h2'); editor.insertContent('Header'); await sleep(250);
      expectKinds('date then Heading 2 in the line below', ['DATE', 'H2']);
      // 2. date, then the Insert title button
      await fresh('');
      await insertDate();
      titleButton().firstElementChild.click(); await sleep(600);
      // the button opens the title window; Insert title in it puts the heading in
      const titleWindow = document.querySelector('.date-reference-overlay');
      if (!titleWindow) fail('the Insert title button did not open the title window');
      else {
        [...titleWindow.querySelectorAll('button')].find(b => /^Insert title$/.test(b.textContent.trim()))?.click();
        await sleep(600);
      }
      const afterTitle = kinds();
      note('header-title-button');
      if (afterTitle.filter(k => k === 'EMPTY').length > 1 || afterTitle.indexOf('EMPTY') === 1) fail(`header under a date (title button): empty line between or more than one at the end: ${afterTitle.join(' ')}`);
      // 3. text under the date; the caret goes into that line and it becomes a heading
      await fresh('');
      await insertDate();
      editor.insertContent('Some notes'); await sleep(200);
      editor.execCommand('mceToggleFormat', false, 'h2'); await sleep(250);
      expectKinds('existing line under the date becomes Heading 2', ['DATE', 'H2']);
      // 4. a heading inserted as content straight after the date
      await fresh('');
      await insertDate();
      editor.insertContent('<h2>Inserted header</h2>'); await sleep(300);
      const afterInsert = kinds();
      note('header-insert-content');
      if (afterInsert[1] === 'EMPTY') fail(`header under a date (inserted content): an empty line sits between them: ${afterInsert.join(' ')}`);
      // 5. two dates with a header under each, written one after the other
      await fresh('');
      for (let i = 0; i < 3; i++) {
        await insertDate();
        editor.execCommand('mceToggleFormat', false, 'h2'); editor.insertContent(`Header ${i + 1}`); await sleep(200);
        editor.execCommand('mceInsertNewLine'); editor.execCommand('mceToggleFormat', false, 'h2'); await sleep(150);
      }
      const many = kinds();
      note('header-three-days');
      const strayBetween = many.some((k, i) => k === 'EMPTY' && many[i - 1] === 'DATE');
      if (strayBetween) fail(`header under a date (three days in a row): empty line directly under a date: ${many.join(' ')}`);
      editor.setContent(savedContent);
      layoutDirty = true;
      await sleep(900);
    },
    // Deleting several rows or columns at once: the grid, the saved table and the record must all agree
    // after every delete, and a second delete straight after the first must not bring anything back.
    async 'multi-delete'() {
      const uid = await createTable('multi table', { rows: 9, cols: 9 });
      if (!uid) return;
      for (let r = 0; r < 9; r += 2) for (let c = 0; c < 9; c += 3) await typeInto(uid, r, c, `m${r}${c}`);
      await verify('multi-delete: filled', true);
      for (let i = 0; i < 8; i++) {
        await multiDelete(uid);
        await verify(`multi-delete ${i + 1}: right after`, false);
        await verify(`multi-delete ${i + 1}: settled`, true);
        const t = tableEl(uid);
        const stored = [t.rows.length - 1, t.rows[0].cells.length - 1];
        note('multi-delete-size-check');
        const m = models.get(uid);
        if (stored[0] !== m.grid.length || stored[1] !== m.grid[0].length) {
          dataLoss.push({ context, table: m.label, problem: `after multi-delete ${i + 1} the saved table is ${stored[0]}x${stored[1]} but the grid is ${m.grid.length}x${m.grid[0].length}` });
        }
        // a quick second delete right away (before the table has caught up)
        if (i % 2 === 1) { await multiDelete(uid); await verify(`multi-delete ${i + 1}b: settled`, true); }
        if (m.grid.length < 5 || m.grid[0].length < 5) break;
      }
      await consistency('multi-delete: inline, popup and stored HTML agree', true);
      await save();
      await verify('multi-delete: saved', true);
    },
    async 'format-and-popup'() {
      const uid = await createTable('format table', { rows: 6, cols: 5 });
      if (!uid) return;
      await typeInto(uid, 0, 0, 'head'); await typeInto(uid, 3, 3, '42');
      await verify('format: filled', true);
      await clickToType(uid);
      await formatting(uid);
      await verify('format: after formatting', true);
      await popupClosing(uid);
      await consistency('format: inline, popup and stored HTML agree', true);
      await measure('format: end');
      await save();
      await verify('format: saved', true);
    },
    // Reported data loss: header cells typed, the column width changed straight after, and the typed text
    // replaced by older grid data. Some rounds leave the last cell's editor open when the resize starts.
    async 'type-then-resize'() {
      const uid = await createTable('resize table', { rows: 6, cols: 5 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let round = 1; round <= 8; round++) {
        const cells = int(2, 4);
        for (let j = 0; j < cells; j++) {
          const leaveOpen = j === cells - 1 && round % 2 === 0;
          await typeDirect(uid, int(0, model().grid.length - 1), int(0, model().grid[0].length - 1), `R${round}x${j}`, leaveOpen ? null : 'Enter');
        }
        await resizeColumn(uid, int(0, model().grid[0].length - 1));
        await verify(`type-then-resize round ${round}`, round % 3 === 0);
      }
      await verify('type-then-resize: final', true);
      verticalAlignCheck(uid, 'after resizes');
      await consistency('type-then-resize: inline, popup and stored HTML agree', true);
      await save();
      await verify('type-then-resize: saved', true);
    },
    // Enter commits and stays; a second Enter moves down; at the last row it stays (no row is added).
    async 'enter-semantics'() {
      const uid = await createTable('enter semantics', { rows: 4, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      await typeDirect(uid, 1, 1, 'mid', 'Enter');
      await enterAgain(uid);
      await enterAgain(uid);
      await verify('enter-semantics: moved down', true);
      for (let i = 0; i < 4; i++) await enterAgain(uid); // runs into the last row and stays there: no row is added
      await verify('enter-semantics: no rows added by Enter', true);
      verticalAlignCheck(uid, 'after Enter at the last row');
      await typeDirect(uid, model().grid.length - 1, 2, 'tail', 'Enter');
      await typeDirect(uid, 0, 0, 'tabbed', 'Tab');
      await verify('enter-semantics: typed after Enter at the last row', true);
      await consistency('enter-semantics: inline, popup and stored HTML agree', true);
    },
    // Text that reaches the grid's hidden input without key presses (input methods, dead keys, dictation).
    async 'sink-text'() {
      const uid = await createTable('sink table', { rows: 5, cols: 4 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let round = 1; round <= 6; round++) {
        const r = int(0, model().grid.length - 1); const c = int(0, model().grid[0].length - 1);
        const root = await selectCell(uid, r, c);
        const sink = root.querySelector('.jss_textarea');
        if (!sink) { fail('the grid has no hidden input'); break; }
        sink.focus();
        const text = pick(['µg/µL', 'Ratio:Primer', '#oligos in panel', 'Total DNA (µg)', 'é à ü']) + ` ${round}`;
        sink.value = text;
        sink.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        let box = null;
        for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
        if (!box || box.value !== text) { fail(`text put in the hidden input was not handed to the cell editor (${box ? JSON.stringify(box.value) : 'no editor'})`, { table: model().label, cell: cellName(r, c) }); continue; }
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await frames(2);
        model().grid[r][c] = text;
        note('sink-text');
        await verify(`sink-text round ${round}`, false);
      }
      await verify('sink-text: final', true);
    },
    // A format button pressed while a cell is still being typed in must keep the text.
    async 'format-after-typing'() {
      const uid = await createTable('format after typing', { rows: 5, cols: 4 });
      if (!uid) return;
      const model = () => models.get(uid);
      const used = new Set(); // Bold is a toggle: a second press on the same cell would turn it off again
      for (let round = 1; round <= 5; round++) {
        let r = int(0, model().grid.length - 1); let c = int(0, model().grid[0].length - 1);
        for (let tries = 0; used.has(`${r},${c}`) && tries < 30; tries++) { r = int(0, model().grid.length - 1); c = int(0, model().grid[0].length - 1); }
        used.add(`${r},${c}`);
        if (!await typeDirect(uid, r, c, `Fmt${round}`, null)) continue;
        const root = api.overlayElement(uid);
        openFormatBar(root); await sleep(300);
        const button = findButton(root, ['Bold']);
        if (!button) { fail('the Bold button was not found'); continue; }
        button.click();
        await sleep(700);
        const td = (api.overlayElement(uid) || root).querySelector(`td[data-x="${c}"][data-y="${r}"]`);
        if (!isBold(td)) fail(`bold did not show on ${cellName(r, c)} typed a moment before`, { table: model().label });
        await verify(`format-after-typing round ${round}`, false);
      }
      await verify('format-after-typing: final', true);
      await consistency('format-after-typing: inline, popup and stored HTML agree', true);
    },
    // The grey columns beside the grid: a click adds the columns up to it and typing there works.
    async 'filler-click'() {
      const uid = await createTable('filler table', { rows: 4, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let round = 1; round <= 3; round++) {
        let root = await selectCell(uid, 0, 0);
        let filler = null;
        // drawn by the layout loop, which runs slower while the page is hidden: wait up to 4 s
        for (let i = 0; i < 40 && !(filler = (api.overlayElement(uid) || root).querySelector('.elabftw-spreadsheet-filler')); i++) await sleep(100);
        root = api.overlayElement(uid) || root;
        if (!filler) {
          // a grid that already fills the width has no room left for grey columns: not a fault
          const grid = (api.overlayElement(uid) || root).querySelector('.elabftw-spreadsheet-readonly-grid');
          const sheet = (api.overlayElement(uid) || root).querySelector('.jss_worksheet');
          const free = grid && sheet ? Math.floor(grid.getBoundingClientRect().right - sheet.getBoundingClientRect().right) : 999;
          if (free < 24) { note('filler-no-room'); break; }
          fail('no grey columns beside the active grid', { table: model().label, free });
          break;
        }
        const cols = model().grid[0].length;
        // any grey cell that is there (how many depends on the width of the page)
        const cell = pick([...filler.querySelectorAll('.fc[data-i][data-r]')]);
        if (!cell) { fail('there are no grey cells to click'); break; }
        const i = Number(cell.dataset.i); const rr = Number(cell.dataset.r);
        cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        await sleep(1000);
        root = api.overlayElement(uid) || root;
        const gotCols = root.querySelectorAll('.jss_worksheet thead td[data-x]').length;
        if (gotCols !== cols + i + 1) dataLoss.push({ context, table: model().label, problem: `clicking a grey cell should leave ${cols + i + 1} columns, there are ${gotCols}` });
        model().grid.forEach(row => { while (row.length < gotCols) row.push(''); });
        await typeDirect(uid, rr, gotCols - 1, `new${round}`, 'Enter');
        await verify(`filler-click round ${round}`, true);
      }
      verticalAlignCheck(uid, 'columns added by the grey cells');
      await consistency('filler-click: inline, popup and stored HTML agree', true);
    },
    // Columns added by pressing a grey cell stay while the table is being worked in and go away once, when the next press
    // lands outside the table (inline) or when Update is pressed (popup); text typed in them keeps them. Clicking back
    // and forth between cells must not add or take away columns (it looked jittery when it did).
    async 'filler-revert'() {
      const uid = await createTable('filler revert', { rows: 4, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      const colsOf = root => root.querySelectorAll('.jss_worksheet thead td[data-x]').length;
      const waitFiller = async root => {
        let filler = null;
        for (let i = 0; i < 40 && !(filler = root.querySelector('.elabftw-spreadsheet-filler .fc[data-i][data-r]') ? root.querySelector('.elabftw-spreadsheet-filler') : null); i++) await sleep(100);
        return filler;
      };
      const pressGrey = async (root, which) => {
        const filler = await waitFiller(root);
        if (!filler) return null;
        const cells = [...filler.querySelectorAll('.fc[data-i][data-r]')];
        const cell = cells[Math.min(which, cells.length - 1)];
        cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        return { i: Number(cell.dataset.i), r: Number(cell.dataset.r) };
      };
      // inline
      let root = await selectCell(uid, 0, 0);
      const base = colsOf(root);
      const inline = await pressGrey(root, 1);
      if (!inline) { note('filler-no-room'); return; }
      await sleep(1000);
      root = api.overlayElement(uid) || root;
      const grown = base + inline.i + 1;
      if (colsOf(root) !== grown) dataLoss.push({ context, table: model().label, where: 'inline', problem: `a grey cell pressed in the text should leave ${grown} columns, there are ${colsOf(root)}` });
      for (let i = 0; i < 3; i++) { await selectCell(uid, i % 2, i); await sleep(500); }
      root = api.overlayElement(uid) || root;
      if (colsOf(root) !== grown) dataLoss.push({ context, table: model().label, where: 'inline', problem: `clicking between cells should leave the ${grown} columns alone, there are ${colsOf(root)}` });
      // a press outside the table takes the empty columns off, once
      (document.querySelector('#experimentsFoldersSidebar') || document.body).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      await sleep(800);
      root = api.overlayElement(uid) || root;
      const afterOutside = root ? colsOf(root) : base;
      if (afterOutside !== base) dataLoss.push({ context, table: model().label, where: 'inline', problem: `empty grey columns should go away when a press lands outside the table (${base} expected), there are ${afterOutside}` });
      note('filler-revert-inline');
      // popup
      const dialog = await openPopupFor(uid);
      const popupBase = colsOf(dialog);
      const first = await pressGrey(dialog, 1);
      if (!first) { note('filler-no-room'); } else {
        await sleep(1000);
        const popupGrown = popupBase + first.i + 1;
        if (colsOf(dialog) !== popupGrown) dataLoss.push({ context, table: model().label, where: 'popup', problem: `a grey cell pressed in the popup should leave ${popupGrown} columns, there are ${colsOf(dialog)}` });
        for (let i = 0; i < 3; i++) { press(dialog.querySelector(`.jss_worksheet td[data-x="${i}"][data-y="${i % 2}"]`)); await sleep(500); }
        if (colsOf(dialog) !== popupGrown) dataLoss.push({ context, table: model().label, where: 'popup', problem: `clicking between cells in the popup should leave the ${popupGrown} columns alone, there are ${colsOf(dialog)}` });
        note('filler-revert-popup');
        // text typed in a grey column keeps it, the empty ones after it are left out by Update
        // the grey cells now start after the columns already added, so the typed column is counted from there
        const colsBeforeSecond = colsOf(dialog);
        const second = await pressGrey(dialog, 0);
        await sleep(500);
        (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true }));
        let box = null;
        for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
        if (!box) { fail('typing over a grey cell in the popup did not open the editor', { table: model().label }); } else {
          box.value = 'zz'; box.dispatchEvent(new Event('input', { bubbles: true }));
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await sleep(1000);
          const want = colsBeforeSecond + second.i + 1;
          model().grid.forEach(row => { while (row.length < want) row.push(''); });
          model().grid[second.r][want - 1] = 'zz';
          note('filler-keep-popup');
        }
      }
      const update = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update');
      if (!update) { fail('the popup has no Update button'); } else { update.click(); await waitPopupGone(); }
      await verify('filler-revert: after Update', true);
      await consistency('filler-revert: inline, popup and stored HTML agree', true);
    },
    // A column the person adds (or deletes) after pressing the grey filler is a real column: the cleanup that takes the empty filler columns off
    // must not delete it (a table used to shrink by columns after a filler press and an Insert column, 5x7 became 5x4).
    async 'filler-then-insert-column'() {
      const uid = await createTable('filler then insert', { rows: 4, cols: 3 });
      if (!uid) return;
      const colsOf = root => root.querySelectorAll('.jss_worksheet thead td[data-x]').length;
      let root = await selectCell(uid, 0, 0);
      let filler = null;
      for (let i = 0; i < 40 && !(filler = root.querySelector('.elabftw-spreadsheet-filler .fc[data-i][data-r]') ? root.querySelector('.elabftw-spreadsheet-filler') : null); i++) await sleep(100);
      if (!filler) { note('filler-no-room'); return; }
      const cells = [...filler.querySelectorAll('.fc[data-i][data-r]')];
      cells[Math.min(1, cells.length - 1)].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      await sleep(1000);
      root = api.overlayElement(uid) || root;
      const grown = colsOf(root);
      const holder = [...root.querySelectorAll('.jss_container')].find(el => el.jssWorksheet);
      if (!holder) { fail('filler-then-insert-column: no worksheet'); return; }
      holder.jssWorksheet.insertColumn(1, grown - 1, false);
      await sleep(900);
      root = api.overlayElement(uid) || root;
      const withInserted = colsOf(root);
      (document.querySelector('#experimentsFoldersSidebar') || document.body).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      await sleep(1000);
      root = api.overlayElement(uid) || root;
      const after = colsOf(root);
      if (after !== withInserted) dataLoss.push({ context, table: 'filler then insert', problem: `a column inserted after a filler press was taken off by the filler cleanup: ${withInserted} columns, then ${after}` });
      const stored = tableEl(uid).rows[0].cells.length - 1;
      if (stored !== after) dataLoss.push({ context, table: 'filler then insert', problem: `the stored table has ${stored} columns, the grid ${after}` });
      note('filler-then-insert-column');
      // this sheet was changed through the worksheet directly: the record follows the columns that are there
      models.get(uid).grid.forEach(row => { while (row.length < after) row.push(''); });
      // the same through the real right-click menu, with the record of the table kept as the mixed session keeps it: the grey filler is pressed
      // (the record gets the columns), then menu inserts and deletes run, then a press outside the table; the table must still be what the record says
      const uid2 = await createTable('filler then menu', { rows: 4, cols: 3 });
      if (!uid2) return;
      for (let round = 0; round < 4; round++) {
        await fillerAdd(uid2);
        for (let k = 0; k < 6; k++) await structureOp(uid2);
        await verify(`filler-then-menu round ${round + 1}`, true);
      }
      (document.querySelector('#experimentsFoldersSidebar') || document.body).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      await sleep(1000);
      // the press outside takes the EMPTY grey columns off on purpose: the record follows what is left, and nothing real (typed, or added by the menu
      // and still empty) may have gone before it, which the verify of each round above has checked
      const left = tableEl(uid2).rows[0].cells.length - 1;
      models.get(uid2).grid.forEach(row => { row.length = Math.min(row.length, left); });
      await verify('filler-then-menu: after a press outside the table', true);
    },
    // A grey filler press followed by a menu row insert at different delays (0 to 1.1 s), many times: the grid keeps the columns the press added and gains
    // exactly one row, and the stored table catches up with the grid (same rows, same columns) within a few seconds. This is the race behind the
    // intermittent "size changed by 1 rows and 2 columns, expected 1 and 0" and "saved table 11x12 instead of 11x14" lines of one soak run:
    // the stored table lagged behind the filler press (see SOAK-TEST.md 11.6); config.raceRounds sets how many rounds (default 16).
    async 'filler-then-menu-race'() {
      const rounds = config.raceRounds || 16;
      const delays = [0, 50, 150, 300, 450, 600, 800, 1100];
      let slowest = 0;
      for (let n = 0; n < rounds; n++) {
        const delay = delays[n % delays.length];
        const label = `filler race ${n + 1} (delay ${delay} ms)`;
        const uid = await createTable(label, { rows: 4, cols: 3 });
        if (!uid) continue;
        const table = label;
        const gridSize = () => { const root = api.overlayElement(uid); return root ? [root.querySelectorAll('.jss_worksheet tbody tr').length, root.querySelectorAll('.jss_worksheet thead td[data-x]').length] : [0, 0]; };
        const storedSize = () => { const t = tableEl(uid); return t ? [t.rows.length - 1, t.rows[0].cells.length - 1] : [0, 0]; };
        let root = await selectCell(uid, 0, 0);
        let filler = null;
        for (let i = 0; i < 40 && !(filler = (api.overlayElement(uid) || root).querySelector('.elabftw-spreadsheet-filler')); i++) await sleep(100);
        if (!filler) { note('filler-no-room'); models.delete(uid); continue; }
        for (let i = 0; i < 40 && Number(filler.dataset.cols) !== (api.overlayElement(uid) || root).querySelectorAll('.jss_worksheet thead td[data-x]').length; i++) await sleep(100);
        const cells = [...filler.querySelectorAll('.fc[data-i][data-r]')];
        cells[Math.min(1 + (n % 3), cells.length - 1)].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        await sleep(delay);
        // the right-click menu of the second row: Insert a new row before
        root = api.overlayElement(uid) || root;
        const td = root.querySelector('td[data-x="0"][data-y="1"]');
        press(td); await sleep(150);
        const hr = td.getBoundingClientRect();
        const rc = { bubbles: true, cancelable: true, view: window, clientX: hr.x + 10, clientY: hr.y + 8, button: 2, buttons: 2 };
        td.dispatchEvent(new PointerEvent('pointerdown', rc)); td.dispatchEvent(new MouseEvent('mousedown', rc));
        td.dispatchEvent(new MouseEvent('mouseup', { ...rc, buttons: 0 })); td.dispatchEvent(new MouseEvent('contextmenu', rc));
        await sleep(300);
        const menu = openMenu();
        const item = menu && [...menu.querySelectorAll('a')].find(a => /insert a new row before/i.test(a.textContent));
        const colsAfterPress = gridSize()[1];
        if (!item) { note('race-no-menu'); models.delete(uid); api.removeTable(uid); continue; }
        clickMenuItem(item);
        const started = performance.now();
        let g = gridSize(); let st = storedSize();
        while (performance.now() - started < 10000 && !(g[0] === 5 && st[0] === 5 && st[1] === g[1])) { await sleep(100); g = gridSize(); st = storedSize(); }
        const took = Math.round(performance.now() - started);
        slowest = Math.max(slowest, took);
        if (g[0] !== 5) dataLoss.push({ context, table, problem: `after the row insert the grid has ${g[0]} rows, expected 5` });
        if (g[1] !== colsAfterPress) dataLoss.push({ context, table, problem: `the grid has ${g[1]} columns after the row insert, ${colsAfterPress} before it` });
        if (st[0] !== g[0] || st[1] !== g[1]) dataLoss.push({ context, table, problem: `the stored table is ${st[0]}x${st[1]} ${took} ms after the row insert, the grid ${g[0]}x${g[1]}` });
        note('filler-then-menu-race');
        models.delete(uid);
        api.removeTable(uid);
        await sleep(500);
      }
      note(`filler-race-slowest-${slowest}ms`);
    },
    // The popup after a grey filler press: the columns the person added (and typed in, or inserted) must still be there after the popup's Update or Cancel
    // (the columns that stayed empty from the grey press only may go, as they do when a press lands outside the table).
    async 'filler-then-popup'() {
      for (const finish of ['update', 'cancel']) {
        const uid = await createTable(`filler then popup (${finish})`, { rows: 4, cols: 3 });
        if (!uid) return;
        const colsOf = root => root.querySelectorAll('.jss_worksheet thead td[data-x]').length;
        let root = await selectCell(uid, 0, 0);
        let filler = null;
        for (let i = 0; i < 40 && !(filler = root.querySelector('.elabftw-spreadsheet-filler .fc[data-i][data-r]') ? root.querySelector('.elabftw-spreadsheet-filler') : null); i++) await sleep(100);
        if (!filler) { note('filler-no-room'); continue; }
        const cells = [...filler.querySelectorAll('.fc[data-i][data-r]')];
        cells[Math.min(2, cells.length - 1)].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        await sleep(1000);
        root = api.overlayElement(uid) || root;
        const holder = [...root.querySelectorAll('.jss_container')].find(el => el.jssWorksheet);
        const grown = colsOf(root);
        // a real column inserted after the press, and text typed into the last one
        holder.jssWorksheet.insertColumn(1, grown - 1, false);
        await sleep(800);
        root = api.overlayElement(uid) || root;
        const withInserted = colsOf(root);
        await typeInto(uid, 0, withInserted - 1, 'real column', 'Enter');
        models.get(uid).grid.forEach(row => { while (row.length < withInserted) row.push(''); });
        models.get(uid).grid[0][withInserted - 1] = 'real column';
        const before = colsOf(api.overlayElement(uid) || root);
        const dialog = await openPopupFor(uid);
        const inPopup = colsOf(dialog);
        if (inPopup < before) dataLoss.push({ context, table: `filler then popup (${finish})`, problem: `the popup shows ${inPopup} columns, the sheet had ${before}` });
        if (finish === 'update') {
          const update = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update');
          if (!update) { fail('the popup has no Update button'); continue; }
          update.click(); await waitPopupGone();
        } else {
          [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click(); await waitPopupGone();
        }
        await sleep(800);
        const after = colsOf(api.overlayElement(uid) || root);
        const stored = tableEl(uid).rows[0].cells.length - 1;
        if (after < before) dataLoss.push({ context, table: `filler then popup (${finish})`, problem: `columns after the popup's ${finish}: ${after}, before it: ${before}` });
        if (stored !== after) dataLoss.push({ context, table: `filler then popup (${finish})`, problem: `the stored table has ${stored} columns, the grid ${after}` });
        models.get(uid).grid.forEach(row => { row.length = Math.min(row.length, after); });
        note('filler-then-popup');
      }
    },
    // Edits made inside a grid are saved without having to leave it.
    async 'autosave-in-grid'() {
      const uid = await createTable('autosave table', { rows: 4, cols: 3 });
      if (!uid) return;
      const token = `AS${Math.random().toString(36).slice(2, 8)}`;
      await typeDirect(uid, 1, 1, token, 'Enter');
      await sleep(11500);
      const id = new URLSearchParams(location.search).get('id');
      const body = (await (await fetch(`/api/v2/experiments/${id}`)).json()).body || '';
      note('autosave-check');
      if (!body.includes(token)) dataLoss.push({ context, table: models.get(uid).label, problem: `"${token}", typed in the grid, was not saved within 11 s of staying in the grid` });
    },
    // Typing straight over cells in the popup: Enter stays, a second Enter moves down (in the last row it stays, no row is added), Update keeps all.
    async 'popup-direct-typing'() {
      const uid = await createTable('popup direct', { rows: 4, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      const dialog = await openPopupFor(uid);
      const popupCell = (c, r) => dialog.querySelector(`.jss_worksheet td[data-x="${c}"][data-y="${r}"]`);
      const popupSelected = () => selectedCells(dialog);
      const typeInPopup = async (r, c, value) => {
        press(popupCell(c, r)); await sleep(300);
        (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: value[0], code: `Key${value[0].toUpperCase()}`, bubbles: true, cancelable: true }));
        let box = null;
        for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
        if (!box) { fail(`typing over ${cellName(r, c)} in the popup did not open the editor`, { table: model().label }); return false; }
        box.value = value; box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(500);
        model().grid[r][c] = value;
        const sel = popupSelected();
        const expectedRow = r < model().grid.length - 1 ? r + 1 : r;
        if (sel.length !== 1 || sel[0][0] !== c || sel[0][1] !== expectedRow) dataLoss.push({ context, table: model().label, where: 'popup', problem: `Enter in ${cellName(r, c)} should leave the cursor on row ${expectedRow + 1}, it is on ${JSON.stringify(sel)}` });
        if (popupCell(c, r).textContent.trim() !== value) dataLoss.push({ context, table: model().label, where: 'popup', cell: cellName(r, c), expected: value, have: popupCell(c, r).textContent.trim() });
        note('popup-type-direct');
        return true;
      };
      await typeInPopup(1, 1, 'pp1');
      (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(500);
      const sel = popupSelected();
      // the first Enter (after typing in B2) already moved to B3 (since 27 October), so the second one lands on B4
      if (sel.length !== 1 || sel[0][0] !== 1 || sel[0][1] !== 3) dataLoss.push({ context, where: 'popup', problem: `a second Enter should select B4 in the popup, selection is ${JSON.stringify(sel)}` });
      await typeInPopup(2, 0, 'pp2');
      const lastRow = dialog.querySelectorAll('.jss_worksheet tbody tr').length - 1;
      press(popupCell(0, lastRow)); await sleep(300);
      (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(900);
      const rowsNow = dialog.querySelectorAll('.jss_worksheet tbody tr').length;
      if (rowsNow !== lastRow + 1) dataLoss.push({ context, where: 'popup', problem: `a second Enter on the last row must not add a row (${lastRow + 1} rows), there are ${rowsNow}` });
      const update = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update');
      if (!update) { fail('the popup has no Update button'); } else { update.click(); await waitPopupGone(); }
      await verify('popup-direct-typing: after Update', true);
      verticalAlignCheck(uid, 'after the popup');
      await consistency('popup-direct-typing: inline, popup and stored HTML agree', true);
    },
    // A table pasted from another application: centred vertically whatever it came with, and editable at once.
    async 'paste-external'() {
      layoutDirty = true;
      const before = new Set(api.snapshot(false).map(snap => snap.uid));
      const cellStyle = 'padding:0px 1px;vertical-align:bottom;line-height:12px;height:15px;font-weight:bold';
      const rows = [['Item', 'Amount'], ['Urea', '12.6g'], ['TBE', '3ml']];
      const html = `<table><tbody>${rows.map(row => `<tr>${row.map(v => `<td style="${cellStyle}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      editor.selection.select(editor.getBody(), true); editor.selection.collapse(false);
      const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', rows.map(r => r.join('\t')).join('\n'));
      editor.getDoc().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(1200);
      const added = api.snapshot(true).filter(snap => !before.has(snap.uid));
      if (added.length !== 1) { fail(`an external paste made ${added.length} spreadsheets, expected 1`); return; }
      const uid = added[0].uid;
      models.set(uid, { label: 'external paste', grid: rows.map(r => r.slice()), plate: false });
      await live(uid);
      await verify('paste-external: pasted', true);
      verticalAlignCheck(uid, 'pasted from another application');
      await rowHeightsUniform(uid, 'an external paste');
      await typeDirect(uid, 1, 1, 'edited', 'Enter');
      await enterAgain(uid);
      await verify('paste-external: edited', true);
      await consistency('paste-external: inline, popup and stored HTML agree', true);
    },
    // A table from Excel, Sheets or Word keeps its column widths: on a <col> in points, in a class of the <style> block,
    // and on the first row's cells as a width attribute. A column without one keeps the default width.
    async 'paste-outside-widths'() {
      layoutDirty = true;
      const cases = [
        { name: 'col in points', css: '', colgroup: '<colgroup><col style="width:150pt"><col style="width:48pt"><col></colgroup>', cellAttr: ['', '', ''], want: [200, 64, 100] },
        { name: 'class in style block', css: '<style>.xl1{width:180px}.xl2{width:60px}</style>', colgroup: '', cellAttr: [' class="xl1"', ' class="xl2"', ''], want: [180, 60, 100] },
        { name: 'width attribute', css: '', colgroup: '', cellAttr: [' width="220"', ' width="90"', ' width="130"'], want: [220, 90, 130] },
      ];
      for (const item of cases) {
        const before = new Set(api.snapshot(false).map(snap => snap.uid));
        const rows = [['a', 'b', 'c'], ['d', 'e', 'f']];
        const html = `${item.css}<table>${item.colgroup}<tbody>${rows.map((row, r) => `<tr>${row.map((v, c) => `<td${r === 0 ? item.cellAttr[c] : ''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        editor.selection.select(editor.getBody(), true); editor.selection.collapse(false);
        const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', rows.map(r => r.join('\t')).join('\n'));
        editor.getDoc().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(1200);
        const added = api.snapshot(true).filter(snap => !before.has(snap.uid));
        if (added.length !== 1) { fail(`${item.name}: an outside paste made ${added.length} spreadsheets, expected 1`); continue; }
        const uid = added[0].uid;
        const pasted = editor.getBody().querySelector(`table[data-elabftw-spreadsheet-uid="${uid}"]`);
        const gutter = pasted?.querySelector('.spreadsheet-coordinate') ? 1 : 0;
        const got = pasted ? [...pasted.querySelectorAll('colgroup > col')].slice(gutter).map(col => Math.round(Number.parseFloat(col.style.width))) : [];
        if (got.join(',') !== item.want.join(',')) fail(`${item.name}: the pasted table has column widths ${got.join(', ')}, expected ${item.want.join(', ')}`);
        models.set(uid, { label: `outside widths (${item.name})`, grid: rows.map(r => r.slice()), plate: false });
        await live(uid);
      }
      await consistency('paste-outside-widths: inline, popup and stored HTML agree', true);
    },
    // A copy of one of our own spreadsheets, pasted through the editor's paste handler (not insertContent), must keep the
    // source's column widths: the conversion to a new sheet used to read row heights but not the <colgroup>.
    async 'paste-copy-widths'() { await pasteCopyWidths(false); },
    async 'paste-copy-widths-rich'() { await pasteCopyWidths(true); },
    // After Tab (or Shift+Enter) the cursor is on another cell, and typing or Enter must act on that one.
    async 'tab-then-type'() {
      const uid = await createTable('tab then type', { rows: 5, cols: 5 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let round = 1; round <= 6; round++) {
        const r = int(0, model().grid.length - 1); const c = int(0, model().grid[0].length - 3);
        await typeDirect(uid, r, c, `T${round}a`, 'Tab');
        await sleep(200);
        const sel = selectedCells(api.overlayElement(uid));
        if (sel.length !== 1 || sel[0][0] !== c + 1 || sel[0][1] !== r) { dataLoss.push({ context, table: model().label, problem: `after Tab from ${cellName(r, c)} the cursor should be on ${cellName(r, c + 1)}, it is on ${JSON.stringify(sel)}` }); }
        // typing straight on, without touching the mouse
        const first = 'q';
        (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: first, code: 'KeyQ', bubbles: true, cancelable: true }));
        let box = null;
        for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
        if (!box) { fail(`typing right after Tab from ${cellName(r, c)} did not open an editor`, { table: model().label }); continue; }
        box.value = `T${round}b`; box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await frames(2);
        model().grid[r][c + 1] = `T${round}b`;
        note('tab-then-type');
        await verify(`tab-then-type round ${round}`, round % 3 === 0);
      }
      await verify('tab-then-type: final', true);
    },
    // Ctrl+Z / Ctrl+Shift+Z in the grid, on an inserted table and on one pasted from another application.
    async 'undo-redo'() {
      const run = async (uid, label) => {
        const model = () => models.get(uid);
        const history = [];
        const typeTracked = async (r, c, value) => {
          const old = model().grid[r][c];
          if (await typeDirect(uid, r, c, value, 'Enter')) history.push([r, c, old, value]);
        };
        await typeTracked(0, 0, `${label}1`); await typeTracked(1, 1, `${label}2`); await typeTracked(2, 2, `${label}3`); await typeTracked(1, 1, `${label}2b`);
        let at = history.length;
        for (let k = 0; k < 3; k++) { await undoKey(uid, false); const [r, c, old] = history[--at]; model().grid[r][c] = old; }
        await verify(`undo-redo ${label}: after 3 undos`, true);
        for (let k = 0; k < 2; k++) { await undoKey(uid, true); const [r, c, , value] = history[at++]; model().grid[r][c] = value; }
        await verify(`undo-redo ${label}: after 2 redos`, true);
        // a new edit after undoing: the rest of the redo list is gone
        history.length = at;
        await typeTracked(3, 0, `${label}new`);
        at = history.length;
        await undoKey(uid, true); // nothing left to redo: must change nothing
        await verify(`undo-redo ${label}: redo after a new edit changes nothing`, true);
        await undoKey(uid, false); { const [r, c, old] = history[--at]; model().grid[r][c] = old; }
        await verify(`undo-redo ${label}: undo of the new edit`, true);
      };
      const made = await createTable('undo table', { rows: 5, cols: 4 });
      if (made) await run(made, 'ins');
      const pasted = await pasteExternal([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l'], ['m', 'n', 'o', 'p'], ['q', 'r', 's', 't']], 'pasted for undo');
      if (pasted) { await live(pasted); await run(pasted, 'pas'); }
      await consistency('undo-redo: inline, popup and stored HTML agree', true);
    },
    // Undo and redo in the grid must reverse every kind of change, not only typed text: typing, bold, alignment, added
    // rows and a dragged column width. A record of the table is taken after each step; undoing walks back through the
    // records one by one (to the table as it was inserted), redoing walks forward again.
    async 'undo-everything'() {
      const uid = await createTable('undo everything', { rows: 4, cols: 4 });
      if (!uid) return;
      const look = async () => {
        const root = api.overlayElement(uid) || await live(uid);
        const cells = [...root.querySelectorAll('.jss_worksheet tbody td[data-x]')].map(td => ({ key: `${td.dataset.x},${td.dataset.y}`, text: td.textContent.trim(), bold: isBold(td), align: alignOf(td) }));
        const widths = [...root.querySelectorAll('.jss_worksheet thead td[data-x]')].map(td => Math.round(td.getBoundingClientRect().width));
        return { rows: root.querySelectorAll('.jss_worksheet tbody tr').length, cells, widths };
      };
      const differences = (a, b) => {
        const out = [];
        if (a.rows !== b.rows) out.push(`rows ${a.rows} vs ${b.rows}`);
        a.cells.forEach((cell, i) => {
          const other = b.cells[i];
          if (!other) return;
          if (cell.text !== other.text) out.push(`${cell.key} text "${cell.text}" vs "${other.text}"`);
          if (cell.bold !== other.bold) out.push(`${cell.key} bold ${cell.bold} vs ${other.bold}`);
          if (cell.align !== other.align) out.push(`${cell.key} align ${cell.align} vs ${other.align}`);
        });
        a.widths.forEach((width, i) => { if (Math.abs(width - (b.widths[i] ?? width)) > 2) out.push(`column ${i} width ${width} vs ${b.widths[i]}`); });
        return out;
      };
      const alignRight = async (r, c) => {
        const root = await live(uid);
        openFormatBar(root); await sleep(300);
        press(root.querySelector(`td[data-x="${c}"][data-y="${r}"]`)); await sleep(200);
        const button = findButton(root, ['Align right']);
        if (!button) { fail('the Align right button was not found'); return; }
        button.click(); await sleep(600);
      };
      await typeDirect(uid, 0, 0, 'base', 'Enter');
      await sleep(600);
      const states = [await look()];
      const kinds = ['inserted'];
      const where = [];
      const steps = [
        ['typing', async () => { const r = int(0, 3); const c = int(0, 3); where.push(`typing ${cellName(r, c)}`); await typeDirect(uid, r, c, `U${int(10, 99)}`, 'Enter'); }],
        ['bold', async () => { const r = int(0, 3); const c = int(0, 3); where.push(`bold ${cellName(r, c)}`); await boldCell(uid, r, c); }],
        ['align right', async () => { const r = int(0, 3); const c = int(0, 3); where.push(`align right ${cellName(r, c)}`); await alignRight(r, c); }],
        ['add rows', async () => { where.push('add rows'); await addRowsBar(uid, 1); }],
        ['column width', async () => { const c = int(0, 3); where.push(`column width ${c}`); await resizeColumn(uid, c); }],
      ];
      // every kind of step once (in a random order), then random ones up to the count
      const count = config.quick ? 5 : 7;
      // Fisher-Yates with the seeded generator: Array.sort with a random comparator takes different numbers of comparisons in V8 and
      // SpiderMonkey, so the same seed gave Chrome and Firefox different step orders. config.undoPlan (a list of step names) forces an order.
      const plan = [...steps];
      for (let i = plan.length - 1; i > 0; i--) { const j = int(0, i); [plan[i], plan[j]] = [plan[j], plan[i]]; }
      while (plan.length < count) plan.push(pick(steps));
      if (Array.isArray(config.undoPlan)) plan.splice(0, plan.length, ...config.undoPlan.map(kind => steps.find(step => step[0] === kind)).filter(Boolean));
      for (const [kind, run] of plan) {
        await run();
        await sleep(500);
        states.push(await look());
        kinds.push(kind);
        note(`undo-everything-step-${kind.replace(/ /g, '-')}`);
      }
      // back through every step, comparing with the record taken before it
      for (let i = states.length - 1; i >= 1; i--) {
        await undoKey(uid, false);
        const diff = differences(await look(), states[i - 1]);
        if (diff.length) dataLoss.push({ context, where: 'grid', problem: `undo of step ${i} (${kinds[i]}) did not restore the table: ${diff.slice(0, 4).join('; ')} [steps: ${kinds.join(' > ')}; cells: ${where.join(' > ')}]` });
        note('undo-everything-undo');
      }
      // and forward again
      for (let i = 1; i < states.length; i++) {
        await undoKey(uid, true);
        const diff = differences(await look(), states[i]);
        if (diff.length) dataLoss.push({ context, where: 'grid', problem: `redo of step ${i} (${kinds[i]}) did not bring the change back: ${diff.slice(0, 4).join('; ')} [steps: ${kinds.join(' > ')}; cells: ${where.join(' > ')}]` });
        note('undo-everything-redo');
      }
      // the record of what was typed no longer matches after undo and redo: leave this table out of later checks
      models.delete(uid);
      api.removeTable(uid);
      // the editor shrinks back to its text a little after the table is gone (a slow headless Chrome took 5 s and more): wait for it, up to 12 s,
      // and say so when it was late; a frame that never shrinks is left for the size check at the end to report
      const iframeEl = editor.getContainer().querySelector('iframe');
      const slack = () => Math.round(iframeEl.getBoundingClientRect().height - Math.max(editor.getDoc().body.scrollHeight, editor.getDoc().body.offsetHeight));
      let waited = 0;
      while (slack() > 160 && waited < 12000 && !document.hidden) { await sleep(500); waited += 500; }
      if (waited > 1500) note(`editor-shrink-late-${waited}ms`);
      await sleep(1500);
    },
    // The Copy table button and a selection copy must carry the values and the formatting.
    async 'copy-table-format'() {
      const uid = await createTable('copy table', { rows: 4, cols: 3 });
      if (!uid) return;
      const captured = [];
      let stubbed = false;
      try {
        Object.defineProperty(navigator.clipboard, 'write', { configurable: true, writable: true, value: async items => {
          for (const item of items) { const entry = {}; for (const type of item.types) entry[type] = await (await item.getType(type)).text(); captured.push(entry); }
        } });
        stubbed = true;
      } catch (error) { note('copy-table-skipped-no-clipboard'); }
      await typeInto(uid, 0, 0, 'Reagent'); await typeInto(uid, 1, 0, 'Tris'); await typeInto(uid, 1, 1, '121.1g'); await typeInto(uid, 2, 2, '0.02M');
      const td = await boldCell(uid, 0, 0, false);
      if (td && !isBold(td)) fail('bold did not show before copying', { table: models.get(uid).label });
      const root = await live(uid);
      if (stubbed) {
        root.querySelector('.elabftw-spreadsheet-readonly-copy-table').click();
        await sleep(800);
        const copy = captured[0];
        if (!copy) dataLoss.push({ context, problem: 'the Copy table button wrote nothing to the clipboard' });
        else {
          ['Reagent', 'Tris', '121.1g', '0.02M'].forEach(v => { if (!(copy['text/html'] || '').includes(v)) dataLoss.push({ context, problem: `"${v}" is missing from the copied table (html)` }); if (!(copy['text/plain'] || '').includes(v)) dataLoss.push({ context, problem: `"${v}" is missing from the copied table (text)` }); });
          if (!/font-weight\s*:\s*(bold|700)/i.test(copy['text/html'] || '')) dataLoss.push({ context, problem: 'the formatting (bold) is missing from the copied table' });
          if (!(copy['text/plain'] || '').includes('\t')) dataLoss.push({ context, problem: 'the plain-text copy has no tab separators' });
        }
        note('copy-table-button');
      }
      // a selection copy through the copy event
      press(root.querySelector('td[data-x="0"][data-y="0"]')); await sleep(200);
      press(root.querySelector('td[data-x="1"][data-y="1"]'), { shiftKey: true }); await sleep(250);
      const dt = new DataTransfer();
      root.querySelector('.elabftw-spreadsheet-readonly-grid').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      note('selection-copy');
      if (!dt.getData('text/plain').includes('Reagent') || !dt.getData('text/plain').includes('121.1g')) dataLoss.push({ context, problem: `the selection copy lost values: ${JSON.stringify(dt.getData('text/plain'))}` });
      if (!/<table/i.test(dt.getData('text/html')) || !/font-weight/i.test(dt.getData('text/html'))) dataLoss.push({ context, problem: 'the selection copy has no HTML table with the bold formatting' });
      await verify('copy-table-format: values unchanged by copying', true);
    },
    // A range copied in one grid and pasted in another brings its formatting along (the popup always did; the grid in
    // the text pasted the values only), and one undo takes values and formatting back together.
    // The clipboard is a plain object with getData/setData, so it works in every browser (a synthetic ClipboardEvent
    // keeps no data in Firefox).
    async 'paste-range-format'() {
      const from = await createTable('paste source', { rows: 4, cols: 3 });
      const to = await createTable('paste target', { rows: 5, cols: 4 });
      if (!from || !to) return;
      const fromModel = models.get(from); const toModel = models.get(to);
      for (const [r, c, v] of [[0, 0, 'b1'], [0, 1, 'b2'], [1, 0, 'b3'], [1, 1, 'b4']]) await typeInto(from, r, c, v);
      const boldSource = await boldCell(from, 0, 0);
      if (!boldSource || !isBold(boldSource)) { fail('could not make the source cell bold'); return; }
      // the target already has a bold cell that the paste must turn plain (source cell B1 is not bold)
      await typeInto(to, 2, 2, 'old');
      await boldCell(to, 2, 2);
      // copy A1:B2 of the source
      const sourceRoot = await live(from);
      press(sourceRoot.querySelector('td[data-x="0"][data-y="0"]')); await sleep(200);
      press(sourceRoot.querySelector('td[data-x="1"][data-y="1"]'), { shiftKey: true }); await sleep(250);
      const store = {};
      const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(copyEvent, 'clipboardData', { value: { setData: (type, value) => { store[type] = value; }, getData: type => store[type] || '' } });
      (document.activeElement && sourceRoot.contains(document.activeElement) ? document.activeElement : sourceRoot.querySelector('.jss_textarea')).dispatchEvent(copyEvent);
      note('range-copy');
      if (!/<table/i.test(store['text/html'] || '')) { dataLoss.push({ context, problem: 'the range copy wrote no HTML table' }); return; }
      // paste at B2 of the target (row 1, column 1): it covers B2:C3, the old bold cell is C3
      const targetRoot = await live(to);
      press(targetRoot.querySelector('td[data-x="1"][data-y="1"]')); await sleep(250);
      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: { getData: type => (type === 'text' || type === 'text/plain') ? (store['text/plain'] || '') : (store[type] || ''), types: Object.keys(store) } });
      (document.activeElement && targetRoot.contains(document.activeElement) ? document.activeElement : targetRoot.querySelector('.jss_textarea')).dispatchEvent(pasteEvent);
      await sleep(900);
      note('range-paste');
      [[1, 1, 'b1'], [1, 2, 'b2'], [2, 1, 'b3'], [2, 2, 'b4']].forEach(([r, c, v]) => { toModel.grid[r][c] = v; });
      await verify('paste-range-format: pasted', true);
      const cell = (r, c) => (api.overlayElement(to) || targetRoot).querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      if (!isBold(cell(1, 1))) dataLoss.push({ context, where: 'inline grid', problem: 'the bold of the copied cell was not pasted with it' });
      if (isBold(cell(1, 2)) || isBold(cell(2, 1))) dataLoss.push({ context, where: 'inline grid', problem: 'a pasted cell that was not bold came out bold' });
      if (isBold(cell(2, 2))) dataLoss.push({ context, where: 'inline grid', problem: 'a bold target cell stayed bold under a plain pasted cell' });
      const stored = tableEl(to).rows[2]?.cells[2];
      if (!/<(strong|b)\b/i.test(stored?.innerHTML || '') && !/font-weight\s*:\s*(bold|[6-9]00)/i.test(stored?.getAttribute('style') || '')) dataLoss.push({ context, where: 'stored table', problem: 'the pasted bold was not saved' });
      // one undo takes the values and the formatting back
      await undoKey(to, false);
      toModel.grid[1][1] = ''; toModel.grid[1][2] = ''; toModel.grid[2][1] = ''; toModel.grid[2][2] = 'old';
      await verify('paste-range-format: undone', true);
      if (isBold(cell(1, 1))) dataLoss.push({ context, where: 'inline grid', problem: 'one undo left the pasted bold behind' });
      if (!isBold(cell(2, 2))) dataLoss.push({ context, where: 'inline grid', problem: 'one undo did not bring back the bold of the cell the paste had turned plain' });
      await undoKey(to, true);
      toModel.grid[1][1] = 'b1'; toModel.grid[1][2] = 'b2'; toModel.grid[2][1] = 'b3'; toModel.grid[2][2] = 'b4';
      await verify('paste-range-format: redone', true);
      if (!isBold(cell(1, 1))) dataLoss.push({ context, where: 'inline grid', problem: 'redo did not bring the pasted bold back' });
      // a copied formula moves its references with the paste (=A3+1 from B3, pasted one column and one row further on,
      // becomes =B4+1): the paste position reaches the grid's hook as text, which once made the shift wrong
      await typeInto(from, 2, 0, '5');
      await typeInto(from, 2, 1, '=A3+1');
      const fromRoot = await live(from);
      press(fromRoot.querySelector('td[data-x="1"][data-y="2"]')); await sleep(250);
      const formulaStore = {};
      const formulaCopy = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(formulaCopy, 'clipboardData', { value: { setData: (type, value) => { formulaStore[type] = value; }, getData: type => formulaStore[type] || '' } });
      (document.activeElement && fromRoot.contains(document.activeElement) ? document.activeElement : fromRoot.querySelector('.jss_textarea')).dispatchEvent(formulaCopy);
      const toRoot = await live(to);
      press(toRoot.querySelector('td[data-x="2"][data-y="3"]')); await sleep(250);
      const formulaPaste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(formulaPaste, 'clipboardData', { value: { getData: type => (type === 'text' || type === 'text/plain') ? (formulaStore['text/plain'] || '') : (formulaStore[type] || '') } });
      (document.activeElement && toRoot.contains(document.activeElement) ? document.activeElement : toRoot.querySelector('.jss_textarea')).dispatchEvent(formulaPaste);
      await sleep(900);
      note('formula-paste');
      toModel.grid[3][2] = '=B4+1';
      const pastedFormula = (api.snapshot(true).find(snap => snap.uid === to)?.overlayData || [])[3]?.[2];
      if (pastedFormula !== '=B4+1') dataLoss.push({ context, where: 'inline grid', problem: `a formula pasted one column and one row further on should read =B4+1, it reads ${JSON.stringify(pastedFormula)}` });
      await verify('paste-range-format: formula pasted', true);
    },
    // The table-wide default border (colour, style, width) and Apply appearance: every cell whose border is still
    // the previous default must follow, each time (it used to change only the cells that had no border of their own).
    async 'default-border-apply'() {
      const uid = await createTable('default border', { rows: 4, cols: 4 });
      if (!uid) return;
      await typeInto(uid, 1, 1, 'x');
      const dialog = await openPopupFor(uid);
      const details = [...dialog.querySelectorAll('details')].find(d => /Table and cell appearance/i.test(d.textContent));
      if (details) { details.open = true; await sleep(200); }
      const labelOf = el => `${el.title} ${el.getAttribute('aria-label') || ''}`;
      const colour = () => [...dialog.querySelectorAll('input[type="color"]')].find(i => labelOf(i).trim() === 'Default border color Default border color');
      const styleSel = () => [...dialog.querySelectorAll('select')].find(el => /default cell border style/i.test(labelOf(el)));
      const widthIn = () => [...dialog.querySelectorAll('input[type="number"]')].find(el => /default cell border width/i.test(labelOf(el)));
      const applyBtn = () => [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Apply appearance');
      if (!colour() || !styleSel() || !widthIn() || !applyBtn()) {
        fail('the popup is missing a default border control', { colour: !!colour(), style: !!styleSel(), width: !!widthIn(), apply: !!applyBtn() });
        const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel'); cancel && cancel.click(); await waitPopupGone(); return;
      }
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const wrong = (cells, expected) => {
        const bad = [];
        cells.forEach(td => {
          const cs = getComputedStyle(td);
          ['Top', 'Right', 'Bottom', 'Left'].forEach(side => {
            const got = `${cs[`border${side}Color`]} ${cs[`border${side}Style`]} ${cs[`border${side}Width`]}`;
            if (got !== expected) bad.push(`${side}: ${got}`);
          });
        });
        return bad;
      };
      const rounds = [['#ff0000', 'solid', '1', 'rgb(255, 0, 0) solid 1px'], ['#0000ff', 'dashed', '2', 'rgb(0, 0, 255) dashed 2px'], ['#00aa00', 'solid', '1', 'rgb(0, 170, 0) solid 1px']];
      for (const [hex, style, width, expected] of rounds) {
        set(colour(), hex); set(styleSel(), style); set(widthIn(), width);
        applyBtn().click();
        await sleep(1100);
        const cells = [...dialog.querySelectorAll('.jss_worksheet tbody td[data-x]')];
        const bad = wrong(cells, expected);
        if (bad.length) dataLoss.push({ context, where: 'popup', problem: `after Apply appearance (${hex} ${style} ${width}px) ${bad.length} cell edges kept an older border, e.g. ${bad.slice(0, 3).join(' | ')}` });
        note('default-border-applied');
      }
      if ([...dialog.querySelectorAll('.jss_worksheet tbody td[data-x]')].find(td => td.dataset.x === '1' && td.dataset.y === '1')?.textContent.trim() !== 'x') dataLoss.push({ context, where: 'popup', problem: 'a cell value changed while the appearance was applied' });
      const update = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update');
      if (update) { update.click(); await waitPopupGone(); }
      await sleep(config.settleMs);
      const saved = wrong([...tableEl(uid).querySelectorAll('tbody td')], rounds[2][3]);
      if (saved.length) dataLoss.push({ context, where: 'saved table', problem: `${saved.length} saved cell edges do not have the last border (${rounds[2][3]}), e.g. ${saved.slice(0, 3).join(' | ')}` });
      await verify('default-border-apply: values unchanged', true);
    },
    // A colour picked in a swatch of the popup's format bar applies by itself after a short pause: no press of the button
    // next to it. Only "input" is sent, as by a colour picker that is still open (its "change" comes when it is closed).
    async 'colour-live'() {
      const uid = await createTable('colour live', { rows: 4, cols: 4 });
      if (!uid) return;
      await typeInto(uid, 0, 0, 'x');
      const dialog = await openPopupFor(uid);
      openFormatBar(dialog);
      const swatch = label => [...dialog.querySelectorAll('input[type="color"]')].find(i => i.getAttribute('aria-label') === label);
      const cellAt = (x, y) => dialog.querySelector(`td[data-x="${x}"][data-y="${y}"]`);
      const rounds = [
        { label: 'Selected cell background color', hex: '#ff0000', prop: 'backgroundColor', expected: 'rgb(255, 0, 0)', cell: [1, 1] },
        { label: 'Selected cell text color', hex: '#0000ff', prop: 'color', expected: 'rgb(0, 0, 255)', cell: [2, 1] },
        { label: 'Selected cell background color', hex: '#00aa00', prop: 'backgroundColor', expected: 'rgb(0, 170, 0)', cell: [1, 2] },
      ];
      for (const round of rounds) {
        const input = swatch(round.label);
        const td = cellAt(...round.cell);
        if (!input || !td) { fail('the popup is missing a colour swatch or a cell', { swatch: round.label, cell: round.cell.join(',') }); continue; }
        press(td); await sleep(250);
        input.value = round.hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1200);
        const got = getComputedStyle(cellAt(...round.cell))[round.prop];
        if (got !== round.expected) dataLoss.push({ context, where: 'popup', problem: `a colour picked in "${round.label}" (${round.hex}) did not apply by itself (${got})` });
        note('colour-live-applied');
      }
      [...dialog.querySelectorAll('button')].find(b => /^Update/.test(b.textContent.trim()))?.click();
      await waitPopupGone();
      await sleep(config.settleMs);
      const stored = (r, c, prop) => tableEl(uid).rows[r + 1]?.cells[c + 1]?.style[prop];
      if (!/255,\s*0,\s*0|#ff0000/i.test(stored(1, 1, 'backgroundColor') || '')) dataLoss.push({ context, where: 'stored table', problem: 'a fill colour picked live in the popup was not saved' });
      if (!/0,\s*0,\s*255|#0000ff/i.test(stored(1, 2, 'color') || '')) dataLoss.push({ context, where: 'stored table', problem: 'a text colour picked live in the popup was not saved' });
      await verify('colour-live: values unchanged', true);
    },
    // The editor's Find and replace marks its matches in the stored table, hidden behind the grid: the grid cells that hold a match
    // must be marked too (the current one stronger), and the marks must go when the search is closed.
    // A sheet wider than the popup must scroll sideways, with the scrollbar inside the visible dialog (not below the fold), and the
    // last column must be reachable: the element that overflows has overflow-x auto/scroll, scrollLeft can be set, and the last
    // column letter becomes visible. The vertical scroll bar and the toolbar stay where they are.
    async 'popup-wide-scroll'() {
      const uid = await createTable('wide popup sheet', { rows: 6, cols: 26 });
      if (!uid) return;
      await typeInto(uid, 1, 25, 'last');
      const dialog = await openPopupFor(uid);
      const container = dialog.querySelector('.inline-spreadsheet-container');
      if (!container) { fail('popup-wide-scroll: no .inline-spreadsheet-container'); return; }
      // the element that has the overflow: the first of the container and its descendants whose content is wider than its box
      const candidates = [container, ...container.querySelectorAll('.jss_container, .jss_content')];
      const scroller = candidates.find(el => el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX));
      const overflowing = candidates.filter(el => el.scrollWidth > el.clientWidth + 1);
      const info = overflowing.map(el => `${el.className.split(' ')[0] || el.tagName}: overflow-x ${getComputedStyle(el).overflowX}, ${el.scrollWidth}>${el.clientWidth}`).join('; ');
      window.__popupScrollInfo = { scroller: scroller ? scroller.className : null, info, container: { overflowX: getComputedStyle(container).overflowX, overflowY: getComputedStyle(container).overflowY, w: container.clientWidth, sw: container.scrollWidth, h: container.clientHeight, offsetH: container.offsetHeight, sbH: container.offsetHeight - container.clientHeight, sbW: container.offsetWidth - container.clientWidth, rect: container.getBoundingClientRect().bottom, dialogBottom: dialog.getBoundingClientRect().bottom, win: window.innerHeight }, dialogW: dialog.getBoundingClientRect().width, content: (() => { const c = container.querySelector('.jss_content'); return c ? { overflowX: getComputedStyle(c).overflowX, w: c.clientWidth, sw: c.scrollWidth, sbH: c.offsetHeight - c.clientHeight } : null; })() };
      if (overflowing.length === 0) { fail('popup-wide-scroll: a 26-column sheet does not overflow the popup (nothing to scroll)', { info }); }
      else if (!scroller) { dataLoss.push({ context, table: 'wide popup sheet', problem: `a sheet wider than the popup has no horizontal scrolling (${info})` }); }
      else {
        // the scroll bar sits at the bottom edge of the scroller: that edge must be inside the dialog and the window
        const box = scroller.getBoundingClientRect(); const dbox = dialog.getBoundingClientRect();
        if (box.bottom > dbox.bottom + 1 || box.bottom > window.innerHeight + 1) {
          dataLoss.push({ context, table: 'wide popup sheet', problem: `the horizontal scroll bar is below the visible dialog (scroller bottom ${Math.round(box.bottom)}, dialog bottom ${Math.round(dbox.bottom)}, window ${window.innerHeight})` });
        }
        scroller.scrollLeft = scroller.scrollWidth;
        await sleep(200);
        const lastHeader = dialog.querySelector('.jss_worksheet thead td[data-x="25"]');
        const sbox = scroller.getBoundingClientRect(); const hbox = lastHeader && lastHeader.getBoundingClientRect();
        if (!lastHeader || hbox.right > sbox.right + 2 || hbox.left < sbox.left) {
          dataLoss.push({ context, table: 'wide popup sheet', problem: 'after scrolling right the last column is not visible' });
        }
        // the column letters scroll with the content, the toolbar does not move
        const toolbarBefore = (dialog.querySelector('button') || dialog).getBoundingClientRect().top;
        scroller.scrollLeft = 0; await sleep(100);
        const toolbarAfter = (dialog.querySelector('button') || dialog).getBoundingClientRect().top;
        if (Math.abs(toolbarBefore - toolbarAfter) > 1) dataLoss.push({ context, table: 'wide popup sheet', problem: 'the toolbar moved while scrolling sideways' });
      }
      [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
      await waitPopupGone();
    },

    // The popup's own scroll bars (drawn when the browser only has overlay bars that hide until you scroll; forced here with
    // window.__forceOverlayScrollbars): a thumb that is smaller than the track when the sheet is wider than the popup, dragging it moves
    // .jss_content sideways, and the last column can be reached.
    async 'popup-own-scrollbar'() {
      window.__forceOverlayScrollbars = true;
      try {
        const uid = await createTable('wide popup sheet (own bar)', { rows: 6, cols: 26 });
        if (!uid) return;
        const dialog = await openPopupFor(uid);
        const container = dialog.querySelector('.inline-spreadsheet-container');
        const bar = container && container.querySelector('.elabftw-own-scrollbar-x');
        const scroller = container && container.querySelector('.jss_content');
        if (!bar || !scroller) { dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: 'the popup has no own horizontal scroll bar in overlay mode' }); }
        else {
          await sleep(300);
          const thumb = bar.querySelector('.elabftw-own-scrollbar-thumb');
          const track = bar.getBoundingClientRect(); const tb = thumb.getBoundingClientRect();
          if (getComputedStyle(bar).visibility !== 'visible' || !(tb.width > 0 && tb.width < track.width)) {
            dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: `own scroll bar thumb missing or full width (visibility ${getComputedStyle(bar).visibility}, thumb ${Math.round(tb.width)} of ${Math.round(track.width)})` });
          }
          if (bar.getBoundingClientRect().bottom > dialog.getBoundingClientRect().bottom + 1) dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: 'the own scroll bar is below the dialog' });
          const before = scroller.scrollLeft;
          const fire = (type, x) => thumb.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: tb.top + 3 }));
          fire('pointerdown', tb.left + 4);
          fire('pointermove', tb.left + 4 + track.width);
          fire('pointerup', tb.left + 4 + track.width);
          await sleep(200);
          if (!(scroller.scrollLeft > before + 50)) dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: `dragging the thumb did not scroll the grid (scrollLeft ${before} -> ${scroller.scrollLeft})` });
          const last = dialog.querySelector('.jss_worksheet thead td[data-x="25"]');
          const sb = scroller.getBoundingClientRect(); const lb = last && last.getBoundingClientRect();
          if (!last || lb.right > sb.right + 2) dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: 'after dragging the thumb to the end the last column is not visible' });
          // the keyboard: Home on the focused bar goes back to the start
          bar.focus(); bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); await sleep(150);
          if (scroller.scrollLeft !== 0) dataLoss.push({ context, table: 'wide popup sheet (own bar)', problem: 'Home on the own scroll bar did not go back to the start' });
        }
        [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
        await waitPopupGone();
      } finally {
        window.__forceOverlayScrollbars = false;
      }
    },

    // A sheet taller than the popup (overlay scroll bars, as on macOS) must show its own vertical bar next to the grid: always visible,
    // a thumb smaller than the track, dragging it scrolls the grid down, the last row can be reached, the bar sits inside the dialog.
    async 'popup-own-scrollbar-y'() {
      window.__forceOverlayScrollbars = true;
      try {
        const uid = await createTable('tall popup sheet (own bar)', { rows: 40, cols: 5 });
        if (!uid) return;
        const dialog = await openPopupFor(uid);
        const container = dialog.querySelector('.inline-spreadsheet-container');
        const bar = container && container.querySelector('.elabftw-own-scrollbar-y');
        const scroller = container && container.querySelector('.jss_content');
        if (!bar || !scroller) { dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: 'the popup has no own vertical scroll bar in overlay mode' }); }
        else {
          await sleep(300);
          const thumb = bar.querySelector('.elabftw-own-scrollbar-thumb');
          const track = bar.getBoundingClientRect(); const tb = thumb.getBoundingClientRect();
          if (scroller.scrollHeight <= scroller.clientHeight + 1) { fail('popup-own-scrollbar-y: a 40-row sheet does not overflow the popup'); }
          else if (getComputedStyle(bar).visibility !== 'visible' || !(tb.height > 0 && tb.height < track.height) || track.width < 3) {
            dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: `own vertical bar missing, hidden or zero width (visibility ${getComputedStyle(bar).visibility}, thumb ${Math.round(tb.height)} of ${Math.round(track.height)}, width ${Math.round(track.width)})` });
          } else {
            const dbox = dialog.getBoundingClientRect();
            if (track.bottom > dbox.bottom + 1 || track.right > dbox.right + 1) dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: 'the own vertical bar is outside the dialog' });
            const before = scroller.scrollTop;
            const fire = (type, y) => thumb.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 8, clientX: tb.left + 2, clientY: y }));
            fire('pointerdown', tb.top + 4); fire('pointermove', tb.top + 4 + track.height); fire('pointerup', tb.top + 4 + track.height);
            await sleep(200);
            if (!(scroller.scrollTop > before + 50)) dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: `dragging the vertical thumb did not scroll the grid (scrollTop ${before} -> ${scroller.scrollTop})` });
            // The grid, not the clipped host, is what scrolls: the grid fits inside the host.
            // (A real wheel over the grid only works when .jss_content is the scroller; a synthetic wheel event does not scroll, so the
            // check is on what the wheel needs: a bounded, scrollable .jss_content that fits inside the host.)
            const hostBox = container.getBoundingClientRect(); const scrBox = scroller.getBoundingClientRect();
            if (scrBox.height > hostBox.height + 1) dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: `the grid (${Math.round(scrBox.height)} px) is taller than the popup's grid area (${Math.round(hostBox.height)} px): it is clipped, not scrolled` });
            scroller.scrollTop = scroller.scrollHeight; await sleep(200);
            const lastRow = dialog.querySelector('.jss_worksheet tbody tr:last-child'); const lr = lastRow && lastRow.getBoundingClientRect(); const sb = scroller.getBoundingClientRect();
            if (!lastRow || lr.bottom > sb.bottom + 2 || lr.top < sb.top - 1) dataLoss.push({ context, table: 'tall popup sheet (own bar)', problem: 'after scrolling to the end the last row is not visible in the popup' });
          }
        }
        [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
        await waitPopupGone();
      } finally {
        window.__forceOverlayScrollbars = false;
      }
    },

    // Widening columns while the popup is open (overlay scroll bars): as soon as the grid overflows, the own bar must appear and be
    // the right size, and it must go again when the columns are made narrow. It used to stay hidden until the popup was reopened.
    async 'popup-scrollbar-after-resize'() {
      window.__forceOverlayScrollbars = true;
      try {
        const uid = await createTable('resize bar sheet', { rows: 6, cols: 8 });
        if (!uid) return;
        const dialog = await openPopupFor(uid);
        const container = dialog.querySelector('.inline-spreadsheet-container');
        const scroller = container && container.querySelector('.jss_content');
        const bar = container && container.querySelector('.elabftw-own-scrollbar-x');
        if (!scroller || !bar) { dataLoss.push({ context, table: 'resize bar sheet', problem: 'the popup has no own scroll bar element in overlay mode' }); }
        else {
          const state = () => {
            const over = scroller.scrollWidth > scroller.clientWidth + 1;
            const thumb = bar.querySelector('.elabftw-own-scrollbar-thumb').getBoundingClientRect();
            const track = bar.getBoundingClientRect();
            return { over, shown: getComputedStyle(bar).visibility === 'visible' && thumb.width > 0 && thumb.width < track.width };
          };
          // Drag the right edge of a column header of the POPUP's grid (the inline grid behind the dialog is not the one under test).
          const dragHeader = async (c, dx) => {
            const header = dialog.querySelector(`.jss_worksheet thead td[data-x="${c}"]`);
            if (!header) { fail(`popup column header ${c} not found`); return false; }
            const rect = header.getBoundingClientRect(); const x = rect.right - 2; const y = rect.top + rect.height / 2;
            const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
            header.dispatchEvent(new PointerEvent('pointerdown', init)); header.dispatchEvent(new MouseEvent('mousedown', init));
            for (let i = 1; i <= 5; i++) { header.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: x + (dx * i) / 5 })); await sleep(15); }
            header.dispatchEvent(new MouseEvent('mouseup', { ...init, clientX: x + dx, buttons: 0 }));
            await sleep(450);
            return true;
          };
          let appeared = false;
          for (let i = 0; i < 12 && !appeared; i++) {
            await dragHeader(i % 4, 220);
            const st = state();
            if (st.over && !st.shown) { dataLoss.push({ context, table: 'resize bar sheet', problem: `after widening columns in the open popup the grid overflows (${scroller.scrollWidth}>${scroller.clientWidth}) but the own scroll bar is not shown` }); break; }
            appeared = st.over && st.shown;
          }
          if (!appeared && !dataLoss.some(d => d.table === 'resize bar sheet')) fail('popup-scrollbar-after-resize: the grid never overflowed after 12 widenings');
          if (appeared) {
            // and back: narrow the columns again until the grid fits, then the bar must be gone
            for (let i = 0; i < 12 && state().over; i++) await dragHeader(i % 4, -220);
            const st = state();
            if (!st.over && st.shown) dataLoss.push({ context, table: 'resize bar sheet', problem: 'the grid fits again after narrowing the columns but the own scroll bar is still shown' });
          }
        }
        [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
        await waitPopupGone();
      } finally {
        window.__forceOverlayScrollbars = false;
      }
    },

    // A table whose every row holds wrapped text: the column-letter row of the grid in the text must still be one line high (it used to
    // follow the lowest row, which is tall when no row is a single line).
    async 'header-not-tall-when-all-rows-wrap'() {
      const uid = await createTable('all rows wrap sheet', { rows: 5, cols: 3 });
      if (!uid) return;
      const long = 'A long text that wraps over several lines in a narrow column to make this row tall';
      for (let r = 0; r < 5; r++) await typeInto(uid, r, 0, long + ' ' + r);
      await sleep(600);
      const root = await live(uid);
      const cells = [...root.querySelectorAll('.jss_worksheet > thead > tr > td[data-x]')];
      const rows = [...root.querySelectorAll('.jss_worksheet > tbody > tr')].map(tr => Math.round(tr.getBoundingClientRect().height));
      const fs = parseFloat(getComputedStyle(cells[0] || root).fontSize) || 16;
      const limit = Math.max(33, Math.round(fs * 2.06)) + 2;
      const tall = cells.map(td => Math.round(td.getBoundingClientRect().height)).filter(h => h > limit);
      if (!cells.length) fail('header-not-tall: no column letters');
      else if (Math.min(...rows) <= limit) fail(`header-not-tall: the rows are not tall enough to test (${rows.join(', ')})`);
      else if (tall.length) dataLoss.push({ context, table: 'all rows wrap sheet', problem: `the column-letter row is ${tall[0]} px high, more than one line (${limit} px) while the rows are ${rows.join(', ')}` });
    },

    // The column-letter row of the popup grid: always as high as the set value (--spreadsheet-column-index-height, 30 px), whatever the
    // rows below hold (long text, wrapped cells, many rows), the same height for every letter, and the letters centred.
    async 'popup-header-look'() {
      const uid = await createTable('header look sheet', { rows: 12, cols: 5 });
      if (!uid) return;
      await typeInto(uid, 2, 1, 'A long text that wraps over several lines in a narrow column to make the row tall');
      const dialog = await openPopupFor(uid);
      await sleep(300);
      const container = dialog.querySelector('.inline-spreadsheet-container');
      const wanted = parseFloat(getComputedStyle(container || dialog).getPropertyValue('--spreadsheet-column-index-height')) || 30;
      const cells = [...dialog.querySelectorAll('.jss_worksheet > thead > tr > td[data-x]')];
      if (cells.length === 0) { fail('popup-header-look: no column letters'); }
      else {
        const heights = cells.map(td => Math.round(td.getBoundingClientRect().height));
        if (heights.some(h => Math.abs(h - wanted) > 1)) dataLoss.push({ context, table: 'header look sheet', problem: `the column-letter row is not ${wanted} px high: ${heights.join(', ')}` });
        const notCentred = cells.filter(td => getComputedStyle(td).textAlign !== 'center').map(td => `${td.textContent.trim()} (${getComputedStyle(td).textAlign}, style="${td.getAttribute('style') || ''}", class="${td.className}")`);
        if (notCentred.length) dataLoss.push({ context, table: 'header look sheet', problem: `column letters not centred: ${notCentred.join(', ')}` });
      }
      [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim()))?.click();
      await waitPopupGone();
    },

    // A column of long text must fit (or, at the widest, be cut at the left edge): never centred and cut off on both sides.
    async 'text-column-fits'() {
      for (const way of ['typing', 'external-html', 'plain-text', 'command']) {
        const made = await makeTextSheet(way);
        if (!made) continue;
        await live(made.uid);
        await sleep(400);
        const m = sheetMetrics(made.uid);
        if (!m) { fail(`text-column-fits: no grid for the sheet made by ${way}`); continue; }
        const table = `text column (${way})`;
        if (m.aligns.some(a => a !== 'left' && a !== 'start')) dataLoss.push({ context, table, problem: `text is aligned ${JSON.stringify(m.aligns)}, it must start at the left unless the source said otherwise` });
        const capped = m.cols[0] >= 360;
        if (m.clipped.length && !capped) dataLoss.push({ context, table, problem: `text is cut off in a column that is not at its widest: cells ${m.clipped.join(' ')} (column A ${m.cols[0]} px)` });
        if (way !== 'typing' && m.cols[0] < 150) dataLoss.push({ context, table, problem: `column A stays ${m.cols[0]} px for text of 24 characters: the pasted/created sheet was not fitted` });
        note('text-column-fits');
      }
    },
    // What is shown before the first click (the preview) must be what the live grid is: same widths, row heights, wrapping,
    // alignment and height. (The preview is built from the stored table, as a reload does: a table inserted in the editor is live at once.)
    async 'preview-equals-live'() {
      for (const way of ['external-html', 'plain-text', 'command', 'typed-then-reloaded']) {
        let made;
        if (way === 'typed-then-reloaded') {
          // a typed sheet, once it is saved: the preview built from its stored table is what a reload shows
          made = await makeTextSheet('typing');
          if (!made) continue;
          await sleep(900);
        } else {
          made = await makeTextSheet(way);
          if (!made) continue;
        }
        // the live grid first, then the preview a reload would build from the same stored table
        await live(made.uid);
        await sleep(900);
        const second = sheetMetrics(made.uid);
        const first = await withPreview(made.uid, host => sheetMetrics(made.uid, true, host));
        const table = `preview vs live (${way})`;
        if (!first || !second) { fail(`preview-equals-live: no metrics (${way})`); continue; }
        const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 2);
        if (!near(first.cols.slice(0, 2), second.cols.slice(0, 2))) dataLoss.push({ context, table, problem: `column widths changed on the first click: ${first.cols.join('/')} -> ${second.cols.join('/')}` });
        if (!near(first.rows, second.rows)) dataLoss.push({ context, table, problem: `row heights changed on the first click: ${first.rows.join('/')} -> ${second.rows.join('/')}` });
        if (JSON.stringify(first.aligns) !== JSON.stringify(second.aligns)) dataLoss.push({ context, table, problem: `text alignment changed on the first click: ${first.aligns.join(',')} -> ${second.aligns.join(',')}` });
        if (Math.abs(first.height - second.height) > 4) dataLoss.push({ context, table, problem: `the data area is ${first.height} px high in the preview and ${second.height} px live` });
        note('preview-equals-live');
      }
    },
    // Text is never cut off at the edges of its cell, however narrow the column or the frame: centred, bold, wrapped text with words wider
    // than the column (long plasmid names: HygR_T2A_EndoTagIGF_CD8TM) must break inside the cell and the row must grow with it.
    // The sheet has user-sized columns (saved widths that are kept), alternating fills and bold rows; it is read in the live grid and in the
    // preview a reload builds, at the full frame and two narrower ones. Each cell: scrollWidth <= clientWidth, scrollHeight <= clientHeight.
    async 'text-not-clipped'() {
      const names = ['#8 (pLVX-TRE3G)', '#1319 (pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-Cherry)', '#1319 (pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-Cherry)',
        '#1318 (pLV-EF1α-HygR_T2A_EndoTagIGF_CD8TM-linker-mCherry)', '#1318 (pLV-EF1α-HygR_T2A_EndoTagIGF_CD8TM-linker-mCherry)',
        '#1317 (pLV-EF1α-HygR_T2A_EndoTagAS_CD8TM-linker-mCherry)', '#1317 (pLV-EF1α-HygR_T2A_EndoTagAS_CD8TM-linker-mCherry)',
        '#1316 (pLV-EF1α-HygR_T2A_LaG17_CD8TM-linker-mCherry)', '#1316 (pLV-EF1α-HygR_T2A_LaG17_CD8TM-linker-mCherry)',
        'HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry_without_any_break_at_all_1234567890'];
      const rows = [['Template (backbone)', 'Digest'], ...names.map((n, i) => [n, `d${i}`])];
      const cellStyles = {};
      rows.forEach((row, r) => row.forEach((_, c) => {
        const bold = r === 0 || r === 4 || r === 5 || r === 9;
        cellStyles[`${cellName(r, c)}`] = `text-align: center; vertical-align: middle; background-color: ${r % 2 ? '#f6f7f8' : '#ffffff'};${bold ? ' font-weight: bold;' : ''}`;
      }));
      for (const [label, colWidths] of [['column kept at 230 px', { 0: 230, 1: 90 }], ['very narrow column (140 px)', { 0: 140, 1: 90 }], ['column nobody sized', undefined]]) {
        layoutDirty = true;
        const before = new Set(api.snapshot(false).map(snap => snap.uid));
        editor.focus();
        editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: rows.length, cols: 2, kind: 'standard', caption: '', cellStyles, ...(colWidths ? { colWidths } : {}) });
        await sleep(1000);
        const added = newTablesSince(before);
        if (added.length !== 1) { fail(`text-not-clipped: ${added.length} spreadsheets were made for "${label}", expected 1`); continue; }
        const uid = added[0].uid;
        models.set(uid, { label: `text not clipped (${label})`, grid: rows.map(r => r.slice()), plate: false });
        const table = `text not clipped (${label})`;
        const check = (where, root, saved) => {
          const ws = root && root.querySelector('.jss_worksheet');
          if (!ws) { fail(`text-not-clipped: no grid (${table}, ${where})`); return null; }
          const cells = [...ws.querySelectorAll('tbody td[data-x][data-y]')].filter(td => td.textContent.trim() !== '');
          const wide = [], tall = [];
          cells.forEach(td => {
            const parts = [td, ...td.querySelectorAll(':scope > .jss-cell-clip')];
            if (parts.some(el => el.scrollWidth > el.clientWidth + 1)) wide.push(`${cellName(+td.dataset.y, +td.dataset.x)}(${td.scrollWidth}>${td.clientWidth})`);
            if (parts.some(el => el.scrollHeight > el.clientHeight + 1)) tall.push(`${cellName(+td.dataset.y, +td.dataset.x)}(${td.scrollHeight}>${td.clientHeight})`);
          });
          const cols = [...ws.querySelectorAll('thead td[data-x]')].map(td => Math.round(td.getBoundingClientRect().width));
          const aligns = [...new Set(cells.map(td => getComputedStyle(td).textAlign))];
          if (!aligns.includes('center')) dataLoss.push({ context, table, problem: `${where}: the test sheet is not centred (${aligns.join(',')}), so it does not test centred text` });
          if (wide.length) dataLoss.push({ context, table, problem: `${where}: text is cut off at the sides of ${wide.length} cells: ${wide.slice(0, 6).join(' ')} (columns ${cols.join('/')} px)` });
          if (tall.length) dataLoss.push({ context, table, problem: `${where}: text is cut off at the bottom of ${tall.length} cells: ${tall.slice(0, 6).join(' ')}` });
          if (saved && cols[0] < saved[0] - 2) dataLoss.push({ context, table, problem: `${where}: column A is ${cols[0]} px, the saved width is ${saved[0]}px` });
          return cols;
        };
        const container = editor.getContainer();
        const original = container.style.width;
        let reference = null;
        try {
          for (const frame of [0, 700, 430]) {
            container.style.width = frame ? `${frame}px` : original;
            window.dispatchEvent(new Event('resize'));
            await sleep(500);
            const root = await live(uid);
            await sleep(400);
            const cols = check(`live, frame ${frame || 'full'}`, root, colWidths && [colWidths[0], colWidths[1]]);
            // the same column keeps one width whatever the frame is (frames scroll, they never squeeze the columns)
            if (cols && reference && Math.abs(cols[0] - reference[0]) > 2) dataLoss.push({ context, table, problem: `live, frame ${frame || 'full'}: column A is ${cols[0]} px, at the full frame it was ${reference[0]} px` });
            if (cols && !reference) reference = cols;
            const previewCols = await withPreview(uid, host => check(`preview, frame ${frame || 'full'}`, host, colWidths && [colWidths[0], colWidths[1]]));
            if (cols && previewCols && Math.abs(cols[0] - previewCols[0]) > 2) dataLoss.push({ context, table, problem: `frame ${frame || 'full'}: column A is ${cols[0]} px live and ${previewCols[0]} px in the preview` });
          }
        } finally {
          container.style.width = original;
          window.dispatchEvent(new Event('resize'));
        }
        note('text-not-clipped');
      }
    },
    // A range copied inside a sheet keeps its look when pasted: into the same sheet, into a second sheet, with the clipboard's HTML table
    // and with the text only (the grid's Paste menu entry reads the text alone), and after a cut. The look is the fill, bold, font size,
    // text colour, alignment and borders of every cell; one undo brings the target's old look back and redo applies it again.
    // Headless Firefox cannot do real clipboard work, but this scenario sends the copy/paste/cut events itself (synthetic clipboard), so it
    // runs there too; the real Ctrl+C / Ctrl+V keys are not exercised (run in Chromium for the closest thing).
    async 'paste-keeps-formatting'() {
      const rows = [['Component', 'Volume (uL)'], ['Vector', '1.44'], ['Insert', '0.309'], ['Master mix', '2.00'], ['Water', '6.25'], ['Total', '10.00']];
      const headerStyle = 'font-size: 10px; font-weight: bold; color: #888888; background-color: #d9e2f3; text-align: left;';
      const totalStyle = 'font-size: 12px; font-weight: bold; font-style: italic; background-color: #fff2cc; border-top: 2px solid #333333;';
      const bodyStyle = (r, c) => `font-size: 12px; color: #1a4f8b; text-align: ${c ? 'right' : 'left'}; background-color: ${r % 2 ? '#e2efda' : '#fce4d6'};`;
      const sourceStyles = {};
      rows.forEach((row, r) => row.forEach((_, c) => { sourceStyles[cellName(r, c)] = r === 0 ? headerStyle : (r === 5 ? totalStyle : bodyStyle(r, c)); }));
      const oldLook = 'font-size: 16px; font-style: italic; color: #cc0000; text-align: center; background-color: #ddddff; border: 3px solid #00aa00;';
      const make = async (label, cols, targetColumn) => {
        layoutDirty = true;
        const full = rows.map(r => [...(targetColumn === 0 ? r.map(() => '') : r), ...Array(cols - 2).fill('')]);
        const styles = { ...sourceStyles };
        full.forEach((row, r) => row.forEach((_, c) => { if (c >= targetColumn) styles[cellName(r, c)] = oldLook; }));
        const before = new Set(api.snapshot(false).map(snap => snap.uid));
        editor.focus();
        editor.execCommand('elabftwInsertSpreadsheetData', false, { data: full, displayData: full, rows: 6, cols, kind: 'standard', caption: '', cellStyles: styles });
        await sleep(1000);
        const added = newTablesSince(before);
        if (added.length !== 1) { fail(`paste-keeps-formatting: ${added.length} spreadsheets were made for ${label}`); return null; }
        models.set(added[0].uid, { label, grid: full.map(r => r.slice()), plate: false });
        return added[0].uid;
      };
      const first = await make('paste formatting source', 5, 3);
      const second = await make('paste formatting second sheet', 4, 0);
      if (!first || !second) return;
      const look = td => { const s = getComputedStyle(td); return [s.fontSize, s.fontWeight, s.fontStyle, s.color, s.textAlign, s.backgroundColor, s.borderTopWidth, s.borderTopColor, s.borderLeftWidth].join('|'); };
      const cellOf = (root, r, c) => root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      const looks = (root, c0) => { const out = []; for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) out.push(look(cellOf(root, r, c0 + c))); return out; };
      const copyRange = async (uid, kind) => {
        const root = await live(uid);
        press(cellOf(root, 0, 0)); await sleep(200);
        press(cellOf(root, 5, 1), { shiftKey: true }); await sleep(250);
        const store = {};
        const event = new ClipboardEvent(kind, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { store[type] = value; }, getData: type => store[type] || '' } });
        (document.activeElement && root.contains(document.activeElement) ? document.activeElement : root.querySelector('.jss_textarea')).dispatchEvent(event);
        await sleep(300);
        return store;
      };
      const pasteAt = async (uid, r, c, store, withHtml) => {
        const root = await live(uid);
        press(cellOf(root, r, c)); await sleep(250);
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        const data = { 'text/plain': store['text/plain'] || '', ...(withHtml ? { 'text/html': store['text/html'] || '' } : {}) };
        Object.defineProperty(event, 'clipboardData', { value: { getData: type => (type === 'text' ? data['text/plain'] : data[type] || ''), types: Object.keys(data) } });
        (document.activeElement && root.contains(document.activeElement) ? document.activeElement : root.querySelector('.jss_textarea')).dispatchEvent(event);
        await sleep(900);
        return root;
      };
      let sourceLooks = null;
      const check = async (label, uid, c0, expected) => {
        const root = api.overlayElement(uid) || await live(uid);
        // the selected cell wears the selection's border: look at a column outside the compared range
        press(cellOf(root, 5, c0 === 0 ? 3 : 0)); await sleep(200);
        const now = looks(root, c0);
        const bad = now.map((value, index) => value === expected[index] ? null : `${cellName(Math.floor(index / 2), c0 + (index % 2))}: ${value} instead of ${expected[index]}`).filter(Boolean);
        if (bad.length) dataLoss.push({ context, table: label, problem: `the pasted range lost its formatting in ${bad.length} of 12 cells: ${bad.slice(0, 2).join('; ')}` });
        return now;
      };
      const rootOne = await live(first);
      sourceLooks = looks(rootOne, 0);
      const table = 'paste keeps formatting';
      if (new Set(sourceLooks).size < 4) fail('paste-keeps-formatting: the source sheet does not show different formatting, the test sheet did not take its styles');
      const targetOldLooks = looks(rootOne, 3);
      const target = (uid, c0) => { const root = api.overlayElement(uid); return [...root.querySelectorAll(`td[data-x="${c0}"][data-y], td[data-x="${c0 + 1}"][data-y]`)].filter(td => +td.dataset.y < 6).map(td => td.getAttribute('style') || ''); };
      const store = await copyRange(first, 'copy');
      if (!/<table/i.test(store['text/html'] || '')) { dataLoss.push({ context, table, problem: 'the range copy wrote no HTML table' }); return; }
      for (const [label, uid, c0, withHtml] of [['same sheet, HTML + text', first, 3, true], ['same sheet, text only (Paste menu)', first, 3, false], ['second sheet, HTML + text', second, 0, true], ['second sheet, text only (Paste menu)', second, 0, false]]) {
        const oldStyles = target(uid, c0);
        const oldRoot = api.overlayElement(uid) || await live(uid);
        press(cellOf(oldRoot, 5, c0 === 0 ? 3 : 0)); await sleep(200);
        const oldNow = looks(oldRoot, c0);
        await pasteAt(uid, 0, c0, store, withHtml);
        note('paste-keeps-formatting');
        await check(`${table}: ${label}`, uid, c0, sourceLooks);
        const grid = models.get(uid).grid;
        rows.forEach((row, r) => row.forEach((value, c) => { grid[r][c0 + c] = value; }));
        const stored = tableEl(uid).rows[1]?.cells[c0 + 1];
        if (!/background-color/i.test(stored?.getAttribute('style') || '')) dataLoss.push({ context, table: `${table}: ${label}`, problem: 'the pasted fill is not in the stored table' });
        await undoKey(uid, false);
        rows.forEach((row, r) => row.forEach((_, c) => { grid[r][c0 + c] = ''; }));
        await verify(`paste-keeps-formatting: ${label} undone`, true);
        void oldStyles;
        await check(`${table}: ${label} undone`, uid, c0, oldNow);
        await undoKey(uid, true);
        rows.forEach((row, r) => row.forEach((value, c) => { grid[r][c0 + c] = value; }));
        await check(`${table}: ${label} redone`, uid, c0, sourceLooks);
        await verify(`paste-keeps-formatting: ${label} redone`, true);
        // back to the target's old look for the next way of pasting
        await undoKey(uid, false);
        rows.forEach((row, r) => row.forEach((_, c) => { grid[r][c0 + c] = ''; }));
      }
      // cut: the pasted range looks like the cut one (and the source is emptied)
      const cutStore = await copyRange(first, 'cut');
      if (!/<table/i.test(cutStore['text/html'] || '')) { dataLoss.push({ context, table, problem: 'the cut wrote no HTML table' }); return; }
      void targetOldLooks;
      await pasteAt(second, 0, 2, cutStore, true);
      note('paste-keeps-formatting');
      await check(`${table}: after a cut`, second, 2, sourceLooks);
      const g1 = models.get(first).grid; const g2 = models.get(second).grid;
      rows.forEach((row, r) => row.forEach((value, c) => { g1[r][c] = ''; g2[r][2 + c] = value; }));
      await verify('paste-keeps-formatting: cut and pasted', true);
    },
    // Text sits in its cell the same way in every row: the same padding from the border (one-line and wrapped rows alike, selected or
    // not), one vertical alignment for all rows, the alignment the cell asked for (left, centred, right) and the same in the preview
    // as in the live grid. The "Backbone" sheet: long plasmid names in a narrow column (150 to 330 px), a centred header.
    async 'cell-alignment-consistent'() {
      const names = ['pLVX-TRE3G-VSVg*', 'pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein-Cas9', 'pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein-Cre',
        'pLV-EF1α-HygR_T2A_EndoTagIGF_CD8TM-linker-mCherry-pHIntein-Cre', 'pLV-EF1α-HygR_T2A_EndoTagIGF_CD8TM-linker-mCherry-pHIntein-Cas9',
        'pLV-EF1α-HygR_T2A_LaG17_CD8TM-linker-mCherry-pHIntein-Cre'];
      const rows = [['Backbone', 'Digest'], ...names.map((n, i) => [n, `d${i}`])];
      const configs = [['left', 150, false], ['left', 200, true], ['left', 330, false], ['center', 165, true], ['right', 165, true]];
      for (const [align, width, withHeights] of configs) {
        layoutDirty = true;
        const cellStyles = {};
        rows.forEach((row, r) => row.forEach((_, c) => {
          cellStyles[cellName(r, c)] = `vertical-align: middle; background-color: ${r % 2 ? '#f6f7f8' : '#ffffff'}; ${r === 0 ? 'text-align: center; font-weight: bold;' : `text-align: ${align};`}${r > 0 && r % 3 === 0 ? ' font-weight: bold;' : ''}`;
        }));
        const rowHeights = withHeights ? Object.fromEntries(rows.slice(1).map((_, i) => [i + 1, i === 0 ? 34 : 112])) : undefined;
        const before = new Set(api.snapshot(false).map(snap => snap.uid));
        editor.focus();
        editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: rows.length, cols: 2, kind: 'standard', caption: '', cellStyles, colWidths: { 0: width, 1: 90 }, ...(rowHeights ? { rowHeights } : {}) });
        await sleep(1000);
        const added = newTablesSince(before);
        if (added.length !== 1) { fail(`cell-alignment-consistent: ${added.length} spreadsheets were made`); continue; }
        const uid = added[0].uid;
        models.set(uid, { label: `alignment ${align} ${width}`, grid: rows.map(r => r.slice()), plate: false });
        const table = `alignment (${align}, ${width} px${withHeights ? ', set row heights' : ''})`;
        const textBox = td => {
          const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
          const rects = [];
          for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) { const r = document.createRange(); r.selectNodeContents(n); rects.push(...r.getClientRects()); }
          if (!rects.length) return null;
          const box = td.getBoundingClientRect();
          return { left: Math.min(...rects.map(r => r.left)) - box.left, right: box.right - Math.max(...rects.map(r => r.right)), top: Math.min(...rects.map(r => r.top)) - box.top, bottom: box.bottom - Math.max(...rects.map(r => r.bottom)) };
        };
        const measureRoot = root => [...root.querySelectorAll('.jss_worksheet tbody td[data-x="0"][data-y]')].filter(td => +td.dataset.y > 0).map(td => {
          const clip = td.querySelector(':scope > .jss-cell-clip');
          const cs = getComputedStyle(td);
          return { y: +td.dataset.y, align: (clip && clip.style.textAlign) || cs.textAlign, va: cs.verticalAlign, box: textBox(td), rowH: td.getBoundingClientRect().height };
        });
        const live1 = await live(uid);
        await sleep(400);
        const liveRows = measureRoot(live1);
        // the column selected: the text keeps its padding from the selection border
        const head = live1.querySelector('.jss_worksheet thead td[data-x="0"]');
        press(head); await sleep(400);
        const selectedRows = measureRoot(live1);
        const previewRows = await withPreview(uid, host => measureRoot(host));
        const padding = parseFloat(getComputedStyle(live1.querySelector('.jss_worksheet tbody td[data-x="0"][data-y="1"]')).paddingLeft) || 8;
        const spread = (list, key) => Math.max(...list.map(r => r.box[key])) - Math.min(...list.map(r => r.box[key]));
        for (const [where, list] of [['live', liveRows], ['live, column selected', selectedRows], ['preview', previewRows]]) {
          if (!list || list.some(r => !r.box)) { fail(`cell-alignment-consistent: no text found (${table}, ${where})`); continue; }
          if (new Set(list.map(r => r.align)).size !== 1 || !list[0].align.includes(align === 'left' ? 'left' : align === 'right' ? 'right' : 'center') && !(align === 'left' && list[0].align === 'start')) dataLoss.push({ context, table, problem: `${where}: the cells ask for ${align} but show ${[...new Set(list.map(r => r.align))].join('/')}` });
          if (new Set(list.map(r => r.va)).size !== 1) dataLoss.push({ context, table, problem: `${where}: rows differ in vertical alignment (${[...new Set(list.map(r => r.va))].join('/')})` });
          const minSide = Math.min(...list.map(r => Math.min(r.box.left, r.box.right)));
          if (minSide < padding - 2) dataLoss.push({ context, table, problem: `${where}: text comes within ${Math.round(minSide)} px of the cell border (padding is ${padding} px)` });
          if (align === 'left' && spread(list, 'left') > 2) dataLoss.push({ context, table, problem: `${where}: the text starts at different distances from the left border: ${list.map(r => Math.round(r.box.left)).join('/')}` });
          if (align === 'right' && spread(list, 'right') > 2) dataLoss.push({ context, table, problem: `${where}: the text ends at different distances from the right border: ${list.map(r => Math.round(r.box.right)).join('/')}` });
          if (!withHeights) list.forEach(r => { if (Math.abs(r.box.top - r.box.bottom) > 4) dataLoss.push({ context, table, problem: `${where}: row ${r.y + 1} text is not vertically centred (${Math.round(r.box.top)} px above, ${Math.round(r.box.bottom)} below)` }); });
        }
        if (liveRows && previewRows && JSON.stringify(liveRows.map(r => r.align)) !== JSON.stringify(previewRows.map(r => r.align))) dataLoss.push({ context, table, problem: `alignment differs between live (${liveRows.map(r => r.align).join(',')}) and preview (${previewRows.map(r => r.align).join(',')})` });
        if (liveRows && selectedRows && liveRows.some((r, i) => Math.abs(r.box.left - selectedRows[i].box.left) > 1.5)) dataLoss.push({ context, table, problem: 'selecting the column moved the text' });
        note('cell-alignment-consistent');
      }
    },
    // A cell keeps its horizontal alignment (left, centred, right) through every way of working with the sheet: the first click, typing in
    // a cell and leaving it, undo and redo, a column resize, Add rows, a save, the popup (cancel and Update) and the preview that a reload shows.
    // Before the fix a centred or right-aligned cell whose text was wider than its column came out left-aligned.
    async 'alignment-preserved'() {
      layoutDirty = true;
      const aligns = ['left', 'center', 'right'];
      const rows = [['short', 'short', 'short'], ['HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry', 'HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry', 'HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry'], ['pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein', 'pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein', 'pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein'], ['x', 'y', 'z']];
      const cellStyles = {};
      rows.forEach((row, r) => row.forEach((_, c) => { cellStyles[cellName(r, c)] = `text-align: ${aligns[c]}; vertical-align: middle;`; }));
      const before = new Set(api.snapshot(false).map(snap => snap.uid));
      editor.focus();
      editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: 4, cols: 3, kind: 'standard', caption: '', cellStyles, colWidths: { 0: 150, 1: 150, 2: 150 }, rowHeights: { 0: 34, 1: 100, 2: 100, 3: 34 } });
      await sleep(1000);
      const added = newTablesSince(before);
      if (added.length !== 1) { fail(`alignment-preserved: ${added.length} spreadsheets were made`); return; }
      const uid = added[0].uid;
      models.set(uid, { label: 'alignment preserved', grid: rows.map(r => r.slice()), plate: false, tallRows: true });
      const table = 'alignment preserved';
      const effective = td => { const clip = td.querySelector(':scope > .jss-cell-clip'); return ((clip && clip.style.textAlign) || getComputedStyle(td).textAlign).replace('start', 'left'); };
      const readLive = root => { const out = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`); out.push(td ? effective(td) : 'missing'); } return out; };
      const expected = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) expected.push(aligns[c]);
      const readStored = () => { const t = tableEl(uid); const out = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) out.push((t.rows[r + 1]?.cells[c + 1]?.style.textAlign || '').replace('start', 'left')); return out; };
      const check = async step => {
        const root = api.overlayElement(uid) || await live(uid);
        const shown = readLive(root);
        if (JSON.stringify(shown) !== JSON.stringify(expected)) dataLoss.push({ context, table, problem: `after ${step}: alignment of the live cells is ${shown.join(',')}, expected ${expected.join(',')}` });
        const stored = readStored();
        if (JSON.stringify(stored) !== JSON.stringify(expected)) dataLoss.push({ context, table, problem: `after ${step}: alignment in the stored table is ${stored.join(',')}, expected ${expected.join(',')}` });
      };
      await live(uid); await sleep(400);
      await check('mounting the grid');
      const root0 = await live(uid);
      press(root0.querySelector('td[data-x="1"][data-y="1"]')); await sleep(300);
      await check('a click on a cell');
      await typeInto(uid, 1, 1, 'edited', 'Enter'); await sleep(500);
      await check('typing in a centred cell and leaving it');
      await undoKey(uid, false); models.get(uid).grid[1][1] = rows[1][1];
      await check('undo');
      await undoKey(uid, true); models.get(uid).grid[1][1] = 'edited';
      await check('redo');
      await typeInto(uid, 2, 2, 'right edited', 'Tab'); await sleep(400);
      await check('typing in a right-aligned cell');
      await resizeColumn(uid, 1); await sleep(500);
      await check('a column resize');
      await addRowsBar(uid, 2); await sleep(500);
      await check('Add rows');
      await save(); await sleep(500);
      await check('a save');
      // the rows Add rows made take the alignment of their column, in the stored table too (it once kept the library's left)
      const addedStored = []; { const t = tableEl(uid); for (let r = 5; r < t.rows.length; r++) for (let c = 0; c < 3; c++) addedStored.push([(t.rows[r].cells[c + 1]?.style.textAlign || 'left').replace('start', 'left'), aligns[c]]); }
      if (addedStored.length === 0 || addedStored.some(([got, want]) => got !== want)) dataLoss.push({ context, table, problem: `the rows added by Add rows are stored as ${addedStored.map(x => x[0]).join(',')}, their columns are ${aligns.join(',')}` });
      await popupEdit(uid, false, 0); await sleep(500);
      await check('opening and cancelling the popup');
      await popupEdit(uid, true, 0); await sleep(1500);
      await check('Update in the popup');
      const previewAligns = await withPreview(uid, host => readLive(host));
      if (previewAligns && JSON.stringify(previewAligns) !== JSON.stringify(expected)) dataLoss.push({ context, table, problem: `the preview shows ${previewAligns.join(',')}, expected ${expected.join(',')}` });
      // rows and columns come and go: every column is still of one alignment and the columns keep their order (left, centred, right)
      const order = { left: 0, center: 1, right: 2 };
      const checkShape = async step => {
        const root = api.overlayElement(uid) || await live(uid);
        const columns = new Map();
        root.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]').forEach(td => {
          const c = +td.dataset.x;
          if (!columns.has(c)) columns.set(c, new Set());
          columns.get(c).add(effective(td));
        });
        const list = [...columns.entries()].sort((x, y) => x[0] - y[0]).map(([, set]) => [...set]);
        if (list.some(set => set.length !== 1)) {
          const odd = [...root.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]')].filter(td => effective(td) === 'left' && +td.dataset.x > 0).slice(0, 3).map(td => `${cellName(+td.dataset.y, +td.dataset.x)} style="${(td.getAttribute('style') || '').slice(0, 50)}" clip=${td.querySelector(':scope > .jss-cell-clip') ? 'yes' : 'no'}`);
          dataLoss.push({ context, table, problem: `after ${step}: a column has cells of different alignment (${list.map(set => set.join('+')).join(' | ')}); e.g. ${odd.join('; ')}` });
        }
        const seq = list.map(set => order[set[0]] ?? 9);
        if (seq.some((value, i) => i > 0 && value < seq[i - 1])) dataLoss.push({ context, table, problem: `after ${step}: the columns changed alignment order (${list.map(set => set.join('+')).join(' | ')})` });
      };
      for (let i = 0; i < 4; i++) { await structureOp(uid); await sleep(300); await checkShape(`structure change ${i + 1} (${opLog[opLog.length - 1]})`); }
      // the fill handle: drag the corner of the selected first cell down over the cells below
      try {
        const rootFill = await live(uid);
        press(rootFill.querySelector('td[data-x="1"][data-y="0"]')); await sleep(250);
        const corner = rootFill.querySelector('.jss_corner');
        const targetCell = rootFill.querySelector('td[data-x="1"][data-y="2"]');
        if (corner && targetCell) {
          const cr = corner.getBoundingClientRect(); const tr = targetCell.getBoundingClientRect();
          const init = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
          corner.dispatchEvent(new MouseEvent('mousedown', { ...init, clientX: cr.x + 2, clientY: cr.y + 2 }));
          for (const target of [rootFill.querySelector('td[data-x="1"][data-y="1"]'), targetCell]) target.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: target.getBoundingClientRect().x + 20, clientY: target.getBoundingClientRect().y + 10 }));
          targetCell.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0, clientX: tr.x + 20, clientY: tr.y + 10 }));
          await sleep(500);
        } else note('fill-handle-not-found');
      } catch (error) { note('fill-handle-error'); }
      await checkShape('dragging the fill handle');
      // the interface size
      const html = document.documentElement;
      const sizeBefore = html.getAttribute('data-ui-size');
      try {
        for (const size of ['comfortable', 'compact']) {
          html.setAttribute('data-ui-size', size); window.dispatchEvent(new Event('resize')); await sleep(600);
          await checkShape(`switching the interface to ${size}`);
        }
      } finally { if (sizeBefore === null) html.removeAttribute('data-ui-size'); else html.setAttribute('data-ui-size', sizeBefore); }
      // sorting is switched off in these sheets (columnSorting: false), so there is no sort to try
      // older data: a sheet whose cells carry no alignment at all (the column option decides) is left-aligned everywhere, live and in the preview
      const legacyRows = [['HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry', 'short'], ['pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein', 'x']];
      const beforeLegacy = new Set(api.snapshot(false).map(snap => snap.uid));
      editor.focus();
      editor.execCommand('elabftwInsertSpreadsheetData', false, { data: legacyRows, displayData: legacyRows, rows: 2, cols: 2, kind: 'standard', caption: '', colWidths: { 0: 150, 1: 90 }, rowHeights: { 0: 100, 1: 100 } });
      await sleep(1000);
      const legacy = newTablesSince(beforeLegacy);
      if (legacy.length === 1) {
        models.set(legacy[0].uid, { label: 'alignment legacy', grid: legacyRows.map(r => r.slice()), plate: false, tallRows: true });
        const rootLegacy = await live(legacy[0].uid);
        await sleep(400);
        const shown = [...rootLegacy.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]')].map(effective);
        const fromPreview = await withPreview(legacy[0].uid, host => [...host.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]')].map(effective));
        if (shown.some(a => a !== 'left') || (fromPreview && fromPreview.some(a => a !== 'left'))) dataLoss.push({ context, table: 'alignment legacy', problem: `cells without an alignment of their own show ${shown.join(',')} live and ${(fromPreview || []).join(',')} in the preview, expected all left` });
      } else fail(`alignment-preserved: ${legacy.length} legacy sheets were made`);
      // what this scenario leaves in the text must be saved, or the check after a reload compares the record with an older save
      await save();
      note('alignment-preserved');
    },
    // The toolbar above a sheet is whole at every frame width and stays put while the sheet scrolls sideways: every button (and the formula
    // bar) inside the frame, the toolbar and the frames not scrolled themselves, nothing moves when the grid is scrolled to its far end.
    // (The "cut toolbar" of a user's screenshot was a crop of the screenshot; this scenario guards against it ever being real.)
    async 'toolbar-not-cut'() {
      layoutDirty = true;
      const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 14 }, (_, c) => `r${r + 1}c${c + 1} HygR_T2A_EndoTagIGF`));
      const before = new Set(api.snapshot(false).map(snap => snap.uid));
      editor.focus();
      editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: 4, cols: 14, kind: 'standard', caption: 'toolbar check', colWidths: Object.fromEntries(Array.from({ length: 14 }, (_, c) => [c, 150])) });
      await sleep(1000);
      const added = newTablesSince(before);
      if (added.length !== 1) { fail(`toolbar-not-cut: ${added.length} spreadsheets were made`); return; }
      const uid = added[0].uid;
      models.set(uid, { label: 'toolbar not cut', grid: rows.map(r => r.slice()), plate: false });
      const table = 'toolbar not cut';
      const container = editor.getContainer();
      const original = container.style.width;
      const snapshot = root => {
        const bar = root.querySelector('.elabftw-spreadsheet-readonly-toggle');
        const box = root.getBoundingClientRect();
        const buttons = bar ? [...bar.querySelectorAll('button, input')].filter(el => el.offsetParent !== null) : [];
        return { bar, box, buttons, rects: buttons.map(el => el.getBoundingClientRect()) };
      };
      try {
        for (const frame of [0, 700, 430, 300]) {
          container.style.width = frame ? `${frame}px` : original;
          window.dispatchEvent(new Event('resize'));
          await sleep(500);
          const root = await live(uid);
          await sleep(400);
          const where = `frame ${frame || 'full'}`;
          const a = snapshot(root);
          if (!a.bar || !a.buttons.length) { fail(`toolbar-not-cut: no toolbar buttons (${where})`); continue; }
          const frameBox = (root.closest('.elabftw-spreadsheet-editor-overlay') || root).getBoundingClientRect();
          a.rects.forEach((r, i) => {
            if (r.left < frameBox.left - 1 || r.right > frameBox.right + 1) dataLoss.push({ context, table, problem: `${where}: toolbar button ${a.buttons[i].title || a.buttons[i].className} runs outside the frame (${Math.round(r.left - frameBox.left)} to ${Math.round(r.right - frameBox.left)} of ${Math.round(frameBox.width)} px)` });
          });
          for (let el = a.bar; el && el !== document.body; el = el.parentElement) {
            if (el.scrollLeft !== 0) dataLoss.push({ context, table, problem: `${where}: ${el.className || el.tagName} is scrolled sideways by ${el.scrollLeft} px, which moves the toolbar` });
          }
          const scroller = root.querySelector('.jss_content');
          if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
            scroller.scrollLeft = scroller.scrollWidth; await sleep(250);
            const b = snapshot(root);
            if (b.rects.some((r, i) => Math.abs(r.left - a.rects[i].left) > 1 || Math.abs(r.top - a.rects[i].top) > 1)) dataLoss.push({ context, table, problem: `${where}: the toolbar moved when the sheet was scrolled to its right end` });
            scroller.scrollLeft = 0;
          }
        }
      } finally {
        container.style.width = original;
        window.dispatchEvent(new Event('resize'));
      }
      note('toolbar-not-cut');
    },
    // Row heights follow the wrapped text: a saved height is a ceiling the user chose (a manual drag and the Auto-fit rows button store the same
    // thing, so a saved height is never changed on load), but the button measures with the real wrapping (long words break inside the cell), and
    // narrowing a column grows the rows that would otherwise cut the text. A row without a saved height is never clipped.
    async 'row-height-fits-text'() {
      layoutDirty = true;
      const rows = [['pLV-EF1α-HygR_T2A_EGFRn_CD8TM-linker-mCherry-pHIntein-Cas9', 'a'], ['HygR_T2A_EndoTagIGF_CD8TM_linker_mCherry_without_a_break_1234567890', 'b'], ['short', 'c']];
      const before = new Set(api.snapshot(false).map(snap => snap.uid));
      editor.focus();
      editor.execCommand('elabftwInsertSpreadsheetData', false, { data: rows, displayData: rows, rows: 3, cols: 2, kind: 'standard', caption: '', colWidths: { 0: 165, 1: 90 }, rowHeights: { 0: 36, 1: 36 } });
      await sleep(1000);
      const added = newTablesSince(before);
      if (added.length !== 1) { fail(`row-height-fits-text: ${added.length} spreadsheets were made`); return; }
      const uid = added[0].uid;
      models.set(uid, { label: 'row height fits text', grid: rows.map(r => r.slice()), plate: false, tallRows: true });
      const table = 'row height fits text';
      const clipped = root => [...root.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]')].filter(td => td.textContent.trim()).filter(td => [td, ...td.querySelectorAll(':scope > .jss-cell-clip')].some(el => el.scrollHeight > el.clientHeight + 1)).map(td => cellName(+td.dataset.y, +td.dataset.x));
      const root = await live(uid);
      await sleep(500);
      const withSaved = clipped(root);
      note('row-height-saved-ceiling');
      // a saved height is the user's ceiling: the rows keep it (36 px) on load
      const h0 = Math.round(root.querySelector('.jss_worksheet tbody tr').getBoundingClientRect().height);
      if (h0 > 60) dataLoss.push({ context, table, problem: `a saved row height of 36 px was changed on load (${h0} px)` });
      const button = root.querySelector('.elabftw-spreadsheet-readonly-autofit-rows');
      if (!button) { fail('row-height-fits-text: no Auto-fit rows button'); return; }
      button.click(); await sleep(900);
      const afterFit = clipped(api.overlayElement(uid) || root);
      if (afterFit.length) dataLoss.push({ context, table, problem: `after Auto-fit rows the text of ${afterFit.join(' ')} is still cut off at the bottom (it was in ${withSaved.length} cells before)` });
      // narrowing the column makes the rows grow with the text
      await resizeColumn(uid, 0);
      const afterResize = clipped(api.overlayElement(uid) || root);
      if (afterResize.length) dataLoss.push({ context, table, problem: `after a column resize the text of ${afterResize.join(' ')} is cut off at the bottom` });
      note('row-height-fits-text');
    },
    // The editor is only as tall as its text: after a table that was made taller (Add rows) is removed, the frame shrinks back within
    // a moment (it used to stay as tall as the table had needed, an empty strip under the text), after Delete and after undo of the insert.
    async 'editor-height-after-removal'() {
      const iframeEl = editor.getContainer().querySelector('iframe');
      const slack = () => Math.round(iframeEl.getBoundingClientRect().height - Math.max(editor.getDoc().body.scrollHeight, editor.getDoc().body.offsetHeight));
      for (const how of ['removed', 'deleted with the toolbar button']) {
        const uid = await createTable(`editor height (${how})`, { rows: 4, cols: 4 });
        if (!uid) continue;
        await addRowsBar(uid, 3);
        await sleep(600);
        const grown = slack();
        if (how === 'removed') api.removeTable(uid);
        else {
          const root = await live(uid);
          const button = root.querySelector('.elabftw-spreadsheet-readonly-delete');
          const confirmBefore = window.confirm; window.confirm = () => true;
          try { button.click(); } finally { window.confirm = confirmBefore; }
        }
        models.delete(uid);
        let waited = 0;
        while (slack() > 120 && waited < 4000) { await sleep(250); waited += 250; }
        const after = slack();
        if (after > 120) dataLoss.push({ context, table: `editor height (${how})`, problem: `the editor frame is ${after} px taller than its text ${waited} ms after the table went (${grown} px right before)` });
        note('editor-height-after-removal');
      }
    },
    // Typing straight over a cell that already has text is one undo step that brings the old text back (not an empty cell), and redo puts
    // the new text in again. (undo-everything with some seeds typed twice into the same cell and then found the cell empty after one undo.)
    async 'undo-typing-over-text'() {
      const uid = await createTable('undo typing over text', { rows: 3, cols: 3 });
      if (!uid) return;
      const cell = () => (api.overlayElement(uid)?.querySelector('td[data-x="1"][data-y="1"]')?.textContent || '').trim();
      await typeDirect(uid, 1, 1, 'first', 'Enter'); await sleep(500);
      // formatting the cell between the two typings (undo-everything's failing order was typing, align right, typing in one cell)
      { const root = await live(uid); openFormatBar(root); await sleep(300); press(root.querySelector('td[data-x="1"][data-y="1"]')); await sleep(200);
        const button = findButton(root, ['Align right']); if (button) { button.click(); await sleep(600); } else fail('undo-typing-over-text: no Align right button'); }
      await typeDirect(uid, 1, 1, 'second', 'Enter'); await sleep(500);
      const table = 'undo typing over text';
      if (cell() !== 'second') { fail(`undo-typing-over-text: the cell shows "${cell()}" after typing twice`); return; }
      await undoKey(uid, false);
      if (cell() !== 'first') dataLoss.push({ context, table, problem: `one undo after typing over "first" leaves "${cell()}" in the cell instead of "first"` });
      await undoKey(uid, false);
      if (cell() !== 'first') dataLoss.push({ context, table, problem: `undoing the alignment between the two typings changed the text to "${cell()}" (it must stay "first")` });
      await undoKey(uid, false);
      if (cell() !== '') dataLoss.push({ context, table, problem: `a third undo leaves "${cell()}" instead of an empty cell` });
      await undoKey(uid, true);
      if (cell() !== 'first') dataLoss.push({ context, table, problem: `redo gives "${cell()}" instead of "first"` });
      await undoKey(uid, true);
      await undoKey(uid, true);
      if (cell() !== 'second') dataLoss.push({ context, table, problem: `a second redo gives "${cell()}" instead of "second"` });
      models.delete(uid);
      api.removeTable(uid);
      await sleep(800);
      note('undo-typing-over-text');
    },
    // Print and the PDF export are built from the stored table (its data-spreadsheet colWidths), not from the live grid, so for paper to look
    // like the screen the widths must be in the stored data and the print copy must keep them. A column nobody sized is stored at the default and
    // the live grid only fits it to its text on screen (fitUnsizedColumns), so the sheet is sized by hand first (drag the headers): then stored
    // data, stored colgroup, live grid and the print copy (the "beforeprint" copy, wide-table choice FIT = the default) must all have the same
    // column widths, a copy wider than the page is only scaled (zoom) to the page width, and the header row repeats (<thead>).
    async 'print-pdf-input-equals-live'() {
      const PAGE = 700; // PRINT_CONTENT_WIDTH of inline-spreadsheet.ts
      const storedWidths = stored => {
        let json = null;
        try { json = JSON.parse(decodeURIComponent(escape(atob(stored.getAttribute('data-spreadsheet') || '')))); } catch { return null; }
        return json.colWidths || {};
      };
      for (const way of ['external-html', 'plain-text']) {
        const made = await makeTextSheet(way);
        if (!made) continue;
        await live(made.uid);
        await sleep(700);
        const table = `print/PDF input (${way})`;
        // size the columns by hand: the text column wider until the sheet is wider than a portrait page (so that FIT has to scale it), the number column a bit wider
        for (let n = 0; n < 6; n++) {
          const total = (sheetMetrics(made.uid)?.cols || []).reduce((a, b) => a + b, 0);
          if (total > PAGE + 60) break;
          if (!await resizeColumn(made.uid, 0)) break;
        }
        await resizeColumn(made.uid, 1);
        await sleep(config.settleMs + 600);
        const m = sheetMetrics(made.uid);
        const stored = tableEl(made.uid);
        if (!m || !stored) { fail(`print-pdf-input-equals-live: no sheet (${way})`); continue; }
        const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 2);
        // 1. stored data (what the PDF reads) = live grid
        const sw = storedWidths(stored);
        const dataWidths = m.cols.map((_, i) => Math.round(Number(sw?.[String(i)]) || 0));
        if (!sw || !near(dataWidths, m.cols)) dataLoss.push({ context, table, problem: `stored colWidths ${dataWidths.join('/')} differ from the live grid ${m.cols.join('/')}` });
        // 2. stored colgroup = live grid
        const widths = [...stored.querySelectorAll(':scope > colgroup > col')].map(c => Math.round(parseFloat(c.style.width) || parseFloat(c.getAttribute('width')) || 0));
        const colgroupData = widths.slice(widths.length - m.cols.length);
        if (!near(colgroupData, m.cols)) dataLoss.push({ context, table, problem: `stored column widths ${colgroupData.join('/')} differ from the live grid ${m.cols.join('/')}` });
        if (!stored.querySelector('thead')) dataLoss.push({ context, table, problem: 'stored table has no <thead>: the header row cannot repeat on each printed page' });
        const coords = stored.querySelectorAll('tbody tr > .spreadsheet-coordinate').length;
        if (coords !== stored.querySelectorAll('tbody tr').length) dataLoss.push({ context, table, problem: `stored table has ${coords} coordinate cells for ${stored.querySelectorAll('tbody tr').length} rows` });
        // 3. the print copy, built the way Ctrl+P builds it, in the default mode (fit)
        const modeBefore = document.body.dataset.sheetsMode;
        document.body.dataset.sheetsMode = 'fit';
        window.dispatchEvent(new Event('beforeprint'));
        await sleep(300);
        try {
          const copies = [...document.querySelectorAll('.print-sheet-copy')].filter(copy => {
            const t = copy.querySelector('table'); const text = t ? t.textContent : '';
            return t && made.rows.every(row => text.includes(row[0].slice(0, 20)));
          });
          // the sheet just made is the last one in the text (an earlier way's sheet has the same text)
          if (copies.length < 1) dataLoss.push({ context, table, problem: 'no print copy of this sheet was made' });
          else {
            const copy = copies[copies.length - 1];
            const printCols = [...copy.querySelectorAll('table > colgroup > col')].map(c => Math.round(parseFloat(c.style.width) || parseFloat(c.getAttribute('width')) || 0));
            const printData = printCols.slice(printCols.length - m.cols.length);
            if (!near(printData, m.cols)) dataLoss.push({ context, table, problem: `print copy column widths ${printData.join('/')} differ from the live grid ${m.cols.join('/')}` });
            const natural = printCols.reduce((a, b) => a + b, 0);
            const zoom = parseFloat(copy.style.zoom) || 1;
            if (natural > PAGE) {
              if (!(zoom < 1) || Math.abs(natural * zoom - PAGE) > 6) dataLoss.push({ context, table, problem: `print copy is ${natural} px wide: fit must scale it to the page width (${PAGE} px), zoom is ${zoom}` });
            } else if (zoom !== 1) dataLoss.push({ context, table, problem: `print copy is ${natural} px wide, it fits the page, but it is scaled (zoom ${zoom})` });
            if (!copy.querySelector('table > thead')) dataLoss.push({ context, table, problem: 'print copy has no <thead>' });
          }
        } finally {
          window.dispatchEvent(new Event('afterprint'));
          if (modeBefore === undefined) delete document.body.dataset.sheetsMode; else document.body.dataset.sheetsMode = modeBefore;
        }
        let printRules = '';
        for (const sheet of document.styleSheets) { let list; try { list = sheet.cssRules; } catch { continue; } for (const r of list) if (r.type === CSSRule.MEDIA_RULE && /print/.test(r.media.mediaText)) printRules += r.cssText; }
        if (!/print-color-adjust:\s*exact/.test(printRules)) dataLoss.push({ context, table, problem: 'no print-color-adjust: exact in the print rules (fills would be lost on paper)' });
        note('print-pdf-input-equals-live');
      }
    },
    // The size of a sheet is its data: no column of 1, 2, 3 and no empty row below that nobody added.
    async 'no-stray-column-row'() {
      for (const shape of [[3, 1], [3, 2]]) {
        const [rowsN, colsN] = shape;
        layoutDirty = true;
        const rows = Array.from({ length: rowsN }, (_, r) => Array.from({ length: colsN }, (_, c) => `r${r + 1}c${c + 1} text`));
        const before = new Set(api.snapshot(false).map(snap => snap.uid));
        await pasteHtmlOrText(`<table><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`, rows.map(r => r.join('\t')).join('\n'));
        const added = newTablesSince(before);
        if (added.length !== 1) { fail(`no-stray-column-row: a ${rowsN}x${colsN} paste made ${added.length} spreadsheets`); continue; }
        models.set(added[0].uid, { label: `stray check ${rowsN}x${colsN}`, grid: rows.map(r => r.slice()), plate: false });
        const stored = tableEl(added[0].uid);
        const storedRows = stored.querySelectorAll('tbody tr').length;
        const storedCols = stored.querySelectorAll('thead th, thead td').length - 1;
        await live(added[0].uid);
        await sleep(400);
        const m = sheetMetrics(added[0].uid);
        // the grey filler columns are not data: count the columns that hold or are headed in the stored table
        const shownCols = [...api.overlayElement(added[0].uid).querySelectorAll('.jss_worksheet thead td[data-x]')].filter(td => !td.classList.contains('elabftw-filler')).length;
        if (storedRows !== rowsN || storedCols !== colsN) dataLoss.push({ context, table: `stray check ${rowsN}x${colsN}`, problem: `stored table is ${storedRows}x${storedCols}, the source was ${rowsN}x${colsN}` });
        if (m && (m.dataRows !== rowsN)) dataLoss.push({ context, table: `stray check ${rowsN}x${colsN}`, problem: `the grid shows ${m.dataRows} rows, the source had ${rowsN}` });
        const firstColumn = [...api.overlayElement(added[0].uid).querySelectorAll('.jss_worksheet tbody td[data-x="0"][data-y]')].map(td => td.textContent.trim());
        if (firstColumn.join(',') === '1,2,3') dataLoss.push({ context, table: `stray check ${rowsN}x${colsN}`, problem: 'column A holds 1,2,3 that nobody typed' });
        note('no-stray-column-row');
        void shownCols;
      }
    },
    // The app's own toasts and tooltips stay inside the window, off the left edge and off the sheet being edited. (The "Last sync was
    // successful" box of the screenshot is the Polybox sync client of the computer, not part of this page.)
    async 'toast-inside-viewport'() {
      const uid = await createTable('toast check', { rows: 3, cols: 3 });
      if (!uid) return;
      const overlayEls = [...document.querySelectorAll('.overlay, .toast, .infotip-text')].filter(el => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const offscreen = r.left >= innerWidth || r.right <= 0 || r.top >= innerHeight || r.bottom <= 0;
        return r.width > 0 && r.height > 0 && !offscreen && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
      });
      const sheetRect = (api.overlayElement(uid) || document.body).getBoundingClientRect();
      for (const el of overlayEls) {
        const r = el.getBoundingClientRect();
        const label = (el.className || el.tagName).toString().slice(0, 40);
        if (r.left < 8 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) dataLoss.push({ context, table: 'toast check', problem: `${label} is not inside the window with a margin: left ${Math.round(r.left)}, right ${Math.round(r.right)} of ${innerWidth}` });
        const header = (api.overlayElement(uid) || document).querySelector('.jss_worksheet thead');
        const hb = header && header.getBoundingClientRect();
        if (hb && r.left < hb.right && r.right > hb.left && r.top < hb.bottom && r.bottom > hb.top && getComputedStyle(el).pointerEvents !== 'none') dataLoss.push({ context, table: 'toast check', problem: `${label} covers the column letters of the sheet and takes clicks` });
      }
      void sheetRect;
      note('toast-inside-viewport');
    },
    // The scroll bars of the sheets in the text are thin, like the popup's.
    async 'inline-scrollbar-thin'() {
      const uid = await createTable('wide inline sheet', { rows: 4, cols: 20 });
      if (!uid) return;
      const root = await live(uid);
      const scroller = root.querySelector('.jss_content');
      if (!scroller) { fail('inline-scrollbar-thin: no scroller'); return; }
      const cs = getComputedStyle(scroller);
      const thin = cs.scrollbarWidth === 'thin' || (scroller.offsetHeight - scroller.clientHeight) <= 10;
      if (!thin) dataLoss.push({ context, table: 'wide inline sheet', problem: `the inline sheet has a thick scroll bar (scrollbar-width ${cs.scrollbarWidth}, ${scroller.offsetHeight - scroller.clientHeight} px)` });
      note('inline-scrollbar-thin');
    },

    // The visible frame must match the table: when the table fits, the frame is exactly its width; when it does not, the frame is
    // the full width available and the scroll bar reaches the real right edge of the last column. Header row as high as the
    // data rows, all rows alike, no clipped text in the last column, no empty strip under the last row.
    async 'viewport-equals-table-width'() {
      for (const [label, cols] of [['narrow table', 2], ['wide table', 24]]) {
        const uid = await createTable(`viewport ${label}`, { rows: 4, cols });
        if (!uid) continue;
        await typeInto(uid, 1, 0, 'fitted text');
        await typeInto(uid, 1, cols - 1, 'last column text');
        const root = await live(uid);
        await sleep(500);
        const scroller = root.querySelector('.jss_content');
        const ws = root.querySelector('.jss_worksheet');
        if (!scroller || !ws) { fail(`viewport-equals-table-width: no grid (${label})`); continue; }
        const table = `viewport (${label})`;
        const tableWidth = Math.round([...ws.querySelectorAll(':scope > colgroup > col')].reduce((sum, col) => sum + (parseFloat(col.getAttribute('width')) || col.getBoundingClientRect().width), 0));
        const frame = scroller.clientWidth;
        const wider = scroller.scrollWidth > scroller.clientWidth + 1;
        if (!wider && frame - tableWidth > 14) dataLoss.push({ context, table, problem: `the table is ${tableWidth} px wide and fits, but its frame is ${frame} px` });
        if (wider) {
          scroller.scrollLeft = scroller.scrollWidth;
          await sleep(120);
          const lastCell = ws.querySelector(`tbody td[data-x="${cols - 1}"]`);
          if (lastCell) {
            const edge = lastCell.getBoundingClientRect().right;
            const frameEdge = scroller.getBoundingClientRect().right;
            if (edge > frameEdge + 2) dataLoss.push({ context, table, problem: `scrolled to the end, the last column still ends ${Math.round(edge - frameEdge)} px beyond the frame` });
          }
          const bar = root.querySelector('.elabftw-own-scrollbar-x');
          const native = scroller.offsetHeight - scroller.clientHeight > 0;
          const barShown = bar && getComputedStyle(bar).visibility !== 'hidden';
          if (!barShown && !native) dataLoss.push({ context, table, problem: 'the table is wider than its frame and there is no horizontal scroll bar' });
          scroller.scrollLeft = 0;
        } else if (tableWidth > frame + 2) {
          dataLoss.push({ context, table, problem: `the table (${tableWidth} px) is wider than its frame (${frame} px) and does not scroll` });
        }
        const head = ws.querySelector('thead tr');
        const rowsH = [...ws.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height));
        if (head && rowsH.length) {
          const headH = Math.round(head.getBoundingClientRect().height);
          if (Math.abs(headH - rowsH[0]) > 3) dataLoss.push({ context, table, problem: `the header row is ${headH} px high, the data rows ${rowsH[0]} px` });
          if (new Set(rowsH.slice(0, 3)).size > 1 && Math.max(...rowsH.slice(0, 3)) - Math.min(...rowsH.slice(0, 3)) > 3) dataLoss.push({ context, table, problem: `the rows are not alike in height: ${rowsH.join('/')}` });
        }
        const lastCell = ws.querySelector(`tbody td[data-x="${cols - 1}"][data-y="1"]`);
        if (lastCell && lastCell.textContent.trim() && lastCell.scrollWidth > lastCell.clientWidth + 1) dataLoss.push({ context, table, problem: 'the text of the last column is cut off' });
        const topGap = ws.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        if (topGap > 6) dataLoss.push({ context, table, problem: `an empty strip of ${Math.round(topGap)} px above the header row` });
        const lastRow = ws.querySelector('tbody tr:last-child');
        if (lastRow && scroller.scrollHeight <= scroller.clientHeight + 1) {
          const gap = scroller.getBoundingClientRect().bottom - lastRow.getBoundingClientRect().bottom;
          if (gap > 10) dataLoss.push({ context, table, problem: `an empty strip of ${Math.round(gap)} px under the last row` });
        }
        note('viewport-equals-table-width');
      }
    },

    async 'find-in-grid'() {
      // a word no earlier run left in this page: matches in other tables would hold the one "current" mark instead
      const word = 'zebrafinch' + Math.random().toString(36).slice(2, 7);
      const uid = await createTable('find in grid', { rows: 4, cols: 3 });
      if (!uid) return;
      await typeInto(uid, 1, 2, word);
      await typeInto(uid, 3, 0, 'another ' + word + ' here');
      // the typed text reaches the stored table (where Find looks) once the grid has written it out: settle first
      await verify('find-in-grid: typed', true);
      const search = editor.plugins?.searchreplace;
      if (!search) { fail('the editor has no Find and replace'); return; }
      const grid = () => api.overlayElement(uid) || document;
      const marked = () => [...grid().querySelectorAll('td.elabftw-find-match')].map(td => `${td.dataset.x},${td.dataset.y}`);
      const currentCount = () => grid().querySelectorAll('td.elabftw-find-match-current').length;
      // the marks follow the editor with a short delay (a page in the background runs timers slowly): wait for them
      const until = async (condition, ms = 4000) => {
        const started = Date.now();
        while (Date.now() - started < ms) { if (condition()) return true; await sleep(100); }
        return condition();
      };
      const found = search.find(word, true, false);
      if (found < 2) fail(`Find counted ${found} matches of a text that is in two cells`);
      await until(() => marked().length >= 2 && currentCount() === 1);
      const now = marked();
      if (!now.includes('2,1') || !now.includes('0,3')) dataLoss.push({ context, table: models.get(uid)?.label, problem: `the cells that hold a match were not marked in the grid (marked: ${now.join(' ') || 'none'})` });
      const findState = () => {
        const body = editor.getBody();
        const markers = [...body.querySelectorAll('.mce-match-marker')];
        return `markers=${markers.length} selected=${markers.filter(m => m.classList.contains('mce-match-marker-selected')).length} current=${currentCount()} marked=${marked().length} cells=${[...grid().querySelectorAll('td.elabftw-find-match-current')].map(td => td.dataset.x + ',' + td.dataset.y).join(' ')}`;
      };
      if (currentCount() !== 1) dataLoss.push({ context, table: models.get(uid)?.label, problem: 'exactly one cell should be marked as the current match (' + findState() + ')' });
      const before = grid().querySelector('td.elabftw-find-match-current')?.dataset.x;
      search.next();
      await until(() => currentCount() === 1 && grid().querySelector('td.elabftw-find-match-current')?.dataset.x !== before);
      if (currentCount() !== 1) dataLoss.push({ context, table: models.get(uid)?.label, problem: 'after Next exactly one cell should be marked as the current match (' + findState() + ')' });
      search.done();
      await until(() => marked().length === 0);
      if (marked().length > 0) dataLoss.push({ context, table: models.get(uid)?.label, problem: `the marks stayed in the grid after the search was closed (${marked().join(' ')})` });
      note('find-in-grid');
      await verify('find-in-grid: values unchanged', true);
    },
    // Dragging over cells: the selection follows, the fill handle lets go of the pointer meanwhile and comes back.
    async 'drag-select'() {
      const uid = await createTable('drag table', { rows: 7, cols: 6 });
      if (!uid) return;
      const model = models.get(uid);
      for (let round = 1; round <= 6; round++) {
        const root = await live(uid);
        const r1 = int(0, 6); const c1 = int(0, 5); const r2 = int(0, 6); const c2 = int(0, 5);
        const start = root.querySelector(`td[data-x="${c1}"][data-y="${r1}"]`);
        const rect = start.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1 };
        start.dispatchEvent(new PointerEvent('pointerdown', init)); start.dispatchEvent(new MouseEvent('mousedown', init));
        await sleep(120);
        const guard = document.body.classList.contains('jss-selecting');
        // walk over the cells of the rectangle, row by row
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
          const tr = td.getBoundingClientRect();
          td.dispatchEvent(new MouseEvent('mouseover', { ...init, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
          td.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
        }
        // the last cell the pointer is over is the far corner of the drag
        { const endCell = root.querySelector(`td[data-x="${c2}"][data-y="${r2}"]`); const er = endCell.getBoundingClientRect();
          endCell.dispatchEvent(new MouseEvent('mouseover', { ...init, clientX: er.x + er.width / 2, clientY: er.y + er.height / 2 }));
          endCell.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: er.x + er.width / 2, clientY: er.y + er.height / 2 })); }
        await sleep(150);
        const corner = root.querySelector('.jss_corner');
        const cornerWhileHeld = corner ? getComputedStyle(corner).pointerEvents : 'no corner';
        const end = root.querySelector(`td[data-x="${c2}"][data-y="${r2}"]`);
        window.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        end.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        await sleep(250);
        const cells = [...root.querySelectorAll('td.highlight')];
        const want = (Math.abs(r2 - r1) + 1) * (Math.abs(c2 - c1) + 1);
        if (cells.length !== want) dataLoss.push({ context, table: model.label, problem: `dragging ${cellName(r1, c1)} to ${cellName(r2, c2)} selected ${cells.length} cells, expected ${want}` });
        if (!guard) fail('the grid did not note that a drag-selection was held');
        if (cornerWhileHeld !== 'none') fail(`the fill handle still took the pointer during a held drag (${cornerWhileHeld})`);
        if (document.body.classList.contains('jss-selecting')) fail('the drag guard stayed on after the button was released');
        const after = corner ? getComputedStyle(root.querySelector('.jss_corner') || corner).pointerEvents : 'auto';
        if (after === 'none') fail('the fill handle stayed unusable after the drag ended');
        note('drag-select');
        await typeDirect(uid, r2, c2, `D${round}`, 'Enter');
      }
      await verify('drag-select: final', true);
    },
    // Ctrl+X (Cmd+X on a Mac): the cut cells must be gone from the grid AND the saved table at once, one Ctrl+Z must bring
    // them all back (grid and saved table), Ctrl+Shift+Z must cut them again. A single cell, then a dragged range.
    async 'cut-undo'() {
      const uid = await createTable('cut table', { rows: 6, cols: 5 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) await typeInto(uid, r, c, `x${r}${c}`, c === 4 ? 'Enter' : 'Tab');
      await verify('cut-undo: filled', true);
      const cutAndCheck = async (label, cells) => {
        const before = cells.map(([r, c]) => model().grid[r][c]);
        await cutKey(uid);
        for (const [r, c] of cells) model().grid[r][c] = '';
        await verify(`cut-undo ${label}: after the cut (cells gone from grid and saved table)`, true);
        note('cut-undo-cut');
        await undoKey(uid, false);
        cells.forEach(([r, c], i) => { model().grid[r][c] = before[i]; });
        await verify(`cut-undo ${label}: after Ctrl+Z (cells back)`, true);
        note('cut-undo-undo');
        await undoKey(uid, true);
        for (const [r, c] of cells) model().grid[r][c] = '';
        await verify(`cut-undo ${label}: after redo (cells cut again)`, true);
        note('cut-undo-redo');
        await undoKey(uid, false);
        cells.forEach(([r, c], i) => { model().grid[r][c] = before[i]; });
        await verify(`cut-undo ${label}: undone again`, true);
      };
      await selectCell(uid, 2, 3);
      await cutAndCheck('single cell', [[2, 3]]);
      // a dragged range of 3 x 2 cells
      const root = await live(uid);
      const [r1, c1, r2, c2] = [1, 1, 3, 2];
      const start = root.querySelector(`td[data-x="${c1}"][data-y="${r1}"]`);
      const rect = start.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1 };
      start.dispatchEvent(new PointerEvent('pointerdown', init)); start.dispatchEvent(new MouseEvent('mousedown', init));
      await sleep(120);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`); const tr = td.getBoundingClientRect();
        td.dispatchEvent(new MouseEvent('mouseover', { ...init, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
        td.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
      }
      const endCell = root.querySelector(`td[data-x="${c2}"][data-y="${r2}"]`);
      window.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 })); endCell.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      await sleep(250);
      const cells = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cells.push([r, c]);
      await cutAndCheck('range', cells);
      // typing after a cut and undo still works, and nothing else was disturbed
      await typeDirect(uid, 5, 4, 'after-cut', 'Enter');
      await verify('cut-undo: typing afterwards', true);
      await consistency('cut-undo: inline, popup and stored HTML agree', true);
    },
    // Cell padding and column fit: text must not touch the cell edges (at least 8 px at each side) and a column holding a
    // long value (up to the 360 px cap) must show it without being clipped.
    async 'padding-fit'() {
      const long = 'Gibson assembly of the insert';
      const pasted = await pasteExternal([['name', 'note', 'n'], [long, 'short', '1'], ['b', 'another fairly long note here', '2']], 'padding fit');
      if (!pasted) return;
      const root = await live(pasted);
      await sleep(600);
      for (const td of root.querySelectorAll('.jss_worksheet tbody td[data-x][data-y]')) {
        const cs = getComputedStyle(td);
        if (parseFloat(cs.paddingLeft) < 8 || parseFloat(cs.paddingRight) < 8) fail(`cell ${td.dataset.x},${td.dataset.y} padding is ${cs.padding}, less than 8 px at the sides`);
        const text = td.textContent.trim();
        if (text.length > 0 && text.length < 40 && td.scrollWidth > td.clientWidth + 1) fail(`cell ${td.dataset.x},${td.dataset.y} ("${text}") is clipped: ${td.scrollWidth} px of text in ${td.clientWidth} px`);
      }
      note('padding-fit');
      await verify('padding-fit: final', true);
    },
    // A sheet whose formula and format bars are open, scrolled out of reach (so another sheet is the active one) and back, shows no
    // blank band where those bars were: its bars are there (a live grid), or there is no gap above the grid at all.
    async 'bars-after-scroll-back'() {
      const a = await createTable('bars table A', { rows: 8, cols: 3 });
      const b = await createTable('bars table B', { rows: 8, cols: 3 });
      if (!a || !b) return;
      const rootA = await live(a);
      openFormatBar(rootA);
      await sleep(500);
      // the band: from the bottom of the bars (or the toolbar) down to the column letters
      const band = root => {
        const head = root.querySelector('.jss_worksheet thead');
        if (!head) return null;
        const bottoms = ['.elabftw-spreadsheet-readonly-toggle', '.elabftw-spreadsheet-format-bar', '.elabftw-spreadsheet-formula-bar']
          .map(sel => root.querySelector(sel)).filter(el => el && el.offsetParent).map(el => el.getBoundingClientRect().bottom);
        const top = root.getBoundingClientRect().top;
        return Math.round(head.getBoundingClientRect().top - Math.max(top, ...bottoms));
      };
      const expanded = band(rootA);
      // make B the active sheet (a press on one of its cells), then take A far out of view and bring it back
      const rootB = await live(b);
      const cellB = rootB.querySelector('.jss_worksheet tbody td[data-x="0"][data-y="0"]');
      if (cellB) { const r = cellB.getBoundingClientRect(); for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) cellB.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + 5, clientY: r.top + 5, button: 0 })); }
      await sleep(500);
      for (let round = 0; round < 2; round++) {
        window.scrollTo(0, document.documentElement.scrollHeight); await sleep(900);
        tableEl(b).scrollIntoView({ block: 'end' }); await sleep(900);
        tableEl(a).scrollIntoView({ block: 'center' }); await sleep(1800);
        const overlay = api.overlayElement(a);
        if (!overlay) { fail('bars-after-scroll-back: the sheet has no grid or preview after scrolling back'); continue; }
        const preview = overlay.classList.contains('elabftw-spreadsheet-preview');
        note(preview ? 'bars-back-as-preview' : 'bars-back-as-grid');
        const gap = band(overlay);
        if (gap !== null && gap > Math.max(12, (expanded ?? 0) + 8)) dataLoss.push({ context, table: 'bars table A', problem: `after scrolling away and back a blank band of ${gap} px sits above the grid (the ${preview ? 'preview' : 'grid'} keeps the room of the formula and format bars without showing them; gap with the bars open: ${expanded} px)` });
      }
      note('bars-after-scroll-back');
      await verify('bars-after-scroll-back: final', true);
    },
    // Formulas and row/column changes: a spreadsheet rewrites the references of a formula when cells move (=A1+1
    // becomes =B1+1 after a column is inserted before A), so the text may change, but a formula cell must never lose
    // its formula, and no other cell may change.
    async 'formulas-and-structure'() {
      const uid = await createTable('formula table', { rows: 7, cols: 7 });
      if (!uid) return;
      const model = () => models.get(uid);
      await typeInto(uid, 0, 0, '2'); await typeInto(uid, 0, 1, '3'); await typeInto(uid, 1, 0, '5');
      for (const [r, c, f] of [[2, 0, '=A1+1'], [2, 2, '=A1+B1'], [3, 3, '=SUM(A1:B1)'], [5, 4, '=A1*2'], [6, 6, '=A2*2']]) await typeInto(uid, r, c, f);
      const resync = (label) => {
        const snap = api.snapshot(true).find(entry => entry.uid === uid);
        const grid = snap?.overlayData || snap?.tableData;
        if (!grid) return;
        model().grid.forEach((row, r) => row.forEach((value, c) => {
          if (typeof value === 'string' && value.startsWith('=')) {
            const have = String(grid[r]?.[c] ?? '');
            if (have.startsWith('=')) model().grid[r][c] = have; // references were rewritten: accepted
            else dataLoss.push({ context: label, table: model().label, cell: cellName(r, c), problem: `the formula ${value} in ${cellName(r, c)} is gone (the cell holds ${JSON.stringify(have)})`, expectedGrid: JSON.stringify(model().grid), actualGrid: JSON.stringify(grid), recentOps: opLog.slice(-14).join(' > '), live: (() => { try { const o = api.overlayElement(uid); const w = o && o.querySelector('.jss_container')?.jspreadsheet; return w ? JSON.stringify(w.getData()) : 'no live grid'; } catch (e) { return 'err ' + e.message; } })(), stored: (() => { const t = tableEl(uid); return t ? `${t.rows.length}x${t.rows[0]?.cells.length}` : 'no table'; })() });
          }
        }));
      };
      await verify('formulas-and-structure: filled', true);
      for (let round = 1; round <= 14; round++) {
        const roll = random();
        if (roll < 0.6) await structureOp(uid);
        else if (roll < 0.8) await multiDelete(uid);
        else await typeInto(uid, int(0, model().grid.length - 1), int(0, model().grid[0].length - 1), pick(['7', '=A1+1', 'text']));
        await sleep(400);
        resync(`formulas-and-structure round ${round}`);
        await verify(`formulas-and-structure round ${round}`, round % 4 === 0);
      }
      resync('formulas-and-structure: final');
      await verify('formulas-and-structure: final', true);
    },
    async mixed() {
      const made = [];
      for (let i = 0; i < 3; i++) {
        if (i) await addText('Results from the next run', int(1, 3));
        const uid = await createTable(`mixed ${i + 1}`, { rows: int(4, 8), cols: int(3, 6) });
        if (uid) made.push(uid);
      }
      for (let round = 1; round <= config.randomRounds; round++) {
        const uid = pick(made);
        const model = models.get(uid);
        const roll = random();
        context = `mixed round ${round}`;
        let name = '';
        try {
          const rr = int(0, model.grid.length - 1); const cc = int(0, model.grid[0].length - 1);
          const ops = [
            [22, 'type', async () => typeInto(uid, rr, cc, random() < 0.2 ? `=${cellName(0, 0)}+1` : String(int(0, 999)))],
            [12, 'type-direct-enter', async () => typeDirect(uid, rr, cc, `D${round}`, 'Enter')],
            [6, 'type-direct-tab', async () => typeDirect(uid, rr, Math.min(cc, model.grid[0].length - 2), `T${round}`, 'Tab')],
            [10, 'type-then-resize', async () => { await typeDirect(uid, rr, cc, `M${round}`, random() < 0.5 ? 'Enter' : null); await resizeColumn(uid, int(0, model.grid[0].length - 1)); }],
            [5, 'type-then-bold', async () => { if (await typeDirect(uid, rr, cc, `B${round}`, null)) await boldCell(uid, rr, cc, true); }],
            [5, 'enter-again', async () => { await selectCell(uid, rr, cc); await enterAgain(uid); }],
            [5, 'sink-text', async () => sinkTextInto(uid, rr, cc, pick(['µg/µL', 'Ratio:Primer', '#oligos in panel', 'é à ü']) + ` ${round}`)],
            [3, 'filler', async () => fillerAdd(uid)],
            [3, 'add-rows-bar', async () => addRowsBar(uid, int(1, 2))],
            [4, 'scroll', async () => { await scrollCheck(`mixed round ${round}`); await live(uid); }],
            [4, 'popup-apply', async () => popupEdit(uid, true, int(1, 2))],
            [3, 'popup-cancel', async () => popupEdit(uid, false, 1)],
            [3, 'multi-delete', async () => multiDelete(uid)],
            [5, 'rows-columns', async () => structureOp(uid)],
            [3, 'menu', async () => menuTour(uid)],
            [4, 'save', async () => save()],
          ];
          let pickRoll = int(1, ops.reduce((sum, op) => sum + op[0], 0));
          let chosen = ops[0];
          for (const op of ops) { if (pickRoll <= op[0]) { chosen = op; break; } pickRoll -= op[0]; }
          name = chosen[1];
          await chosen[2]();
        } catch (error) {
          fail(`${name}: ${error && error.message || error}`, { stack: String(error && error.stack || '').split('\n').slice(0, 4).join(' | ') });
        }
        await sleep(pick([0, 30, 120, 450, 520, 700]));
        try {
          const stored = tableEl(uid); const overlay = api.overlayElement(uid);
          colTrail.push(`${name}[m${models.get(uid)?.grid[0]?.length} l${overlay ? overlay.querySelectorAll('.jss_worksheet thead td[data-x]').length : '-'} s${stored ? stored.rows[0].cells.length - 1 : '-'}]`);
          if (colTrail.length > 40) colTrail.shift();
        } catch { /* the trail is only a diagnostic */ }
        await measure(`mixed round ${round} ${name}`);
        await verify(`mixed round ${round} ${name}`, round % 6 === 0);
      }
      await verify('mixed: final', true);
      await consistency('mixed: inline, popup and stored HTML agree', true);
    },
  };

  // ---- the run --------------------------------------------------------------------------
  const sessionEnds = [];
  for (let session = 1; session <= config.sessions; session++) {
    const nodesAtStart = document.getElementsByTagName('*').length + editor.getDoc().getElementsByTagName('*').length;
    for (const name of config.scenarios) {
      if (!scenarios[name]) continue;
      context = `session ${session} ${name}`;
      layoutDirty = true;
      window.spreadsheetSoakProgress = { session, sessions: config.sessions, scenario: name, dataLoss: dataLoss.length, failures: failures.length };
      try { await scenarios[name](); } catch (error) { fail(`${name} stopped: ${error && error.message || error}`, { stack: String(error && error.stack || '').split('\n').slice(0, 4).join(' | ') }); }
      if (!config.accumulate && name !== config.scenarios[config.scenarios.length - 1]) {
        // each scenario starts on a clean page, like opening a fresh experiment
        await sleep(config.settleMs);
        const opened = !!document.querySelector('.inline-spreadsheet-dialog');
        if (opened) fail('a popup was left open at the end of the scenario');
        sessionStorage.setItem('spreadsheetSoak', JSON.stringify({
          at: Date.now(), baseline: baselineTables,
          expected: api.snapshot(true).filter(snap => models.has(snap.uid)).map(snap => ({ label: models.get(snap.uid).label, grid: models.get(snap.uid).grid, plate: !!models.get(snap.uid).plate })),
        }));
        for (const uid of [...models.keys()]) api.removeTable(uid);
        models.clear();
        layoutDirty = true;
        await sleep(600);
      }
      samples.push({
        session, scenario: name,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        nodes: document.getElementsByTagName('*').length + editor.getDoc().getElementsByTagName('*').length,
        overlays: document.querySelectorAll('.elabftw-spreadsheet-editor-overlay').length,
        menusInPage: document.querySelectorAll('.jcontextmenu, .jss_contextmenu').length,
      });
    }
    // Keep the last session's tables for the reload check; clear the others so every session starts alike.
    if (session < config.sessions || !config.keepTables) {
      const order = api.snapshot(true);
      sessionStorage.setItem('spreadsheetSoak', JSON.stringify({
        at: Date.now(), baseline: baselineTables,
        expected: order.filter(snap => models.has(snap.uid)).map(snap => ({ label: models.get(snap.uid).label, grid: models.get(snap.uid).grid, plate: !!models.get(snap.uid).plate })),
      }));
    }
    if (session < config.sessions) {
      for (const uid of [...models.keys()]) { api.removeTable(uid); }
      models.clear();
      await sleep(1200);
      const nodesAtEnd = document.getElementsByTagName('*').length + editor.getDoc().getElementsByTagName('*').length;
      sessionEnds.push({ session, nodesAtStart, nodesAtEnd, left: nodesAtEnd - nodesAtStart });
      if (nodesAtEnd - nodesAtStart > 300) fail(`session ${session} left ${nodesAtEnd - nodesAtStart} extra page elements behind after its tables were removed`);
    }
  }
  context = 'end';
  await save();
  await verify('final settled', true);
  await measure('final');
  window.confirm = originalConfirm;

  // ---- 4. slowing down ------------------------------------------------------------------
  const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const slower = [];
  const perStep = {};
  for (const [name, list] of Object.entries(timings)) {
    const third = Math.max(3, Math.floor(list.length / 3));
    const first = median(list.slice(0, third)); const last = median(list.slice(-third));
    perStep[name] = { runs: list.length, firstThirdMs: first, lastThirdMs: last, slowestMs: Math.max(...list) };
    if (list.length >= 9 && last > first * 1.6 && last - first > 60) slower.push({ step: name, firstThirdMs: first, lastThirdMs: last });
  }
  const heaps = samples.map(s => s.heapMB).filter(v => v !== null);
  let heapGrowth = null;
  if (heaps.length >= 6) {
    heapGrowth = { startMB: heaps[2], endMB: heaps[heaps.length - 1] };
    if (heaps[heaps.length - 1] > heaps[2] * 1.5 && heaps[heaps.length - 1] - heaps[2] > 40) slower.push({ step: 'memory', ...heapGrowth });
  }
  const last = samples[samples.length - 1];
  if (last && last.menusInPage > last.overlays + 2) fail(`${last.menusInPage} menu elements for ${last.overlays} grids are left in the page`);

  const hiddenTotal = Object.values(hiddenRuns || {}).reduce((sum, n) => sum + n, 0);
  const shownTotal = Object.values(perStep || {}).reduce((sum, v) => sum + (v.runs || 0), 0);
  const hiddenShare = hiddenTotal + shownTotal > 0 ? hiddenTotal / (hiddenTotal + shownTotal) : 0;
  const result = {
    hiddenShare: Math.round(hiddenShare * 100),
    verdict: (hiddenShare > 0.2 ? `INCONCLUSIVE: the page was hidden for ${Math.round(hiddenShare * 100)}% of the steps (screen asleep, window covered or tab in the background), so size and position checks mean little. ` : '') + (dataLoss.length === 0 && failures.length === 0 && sizes.problems.length === 0 && menus.problems.length === 0 && slower.length === 0
      ? 'CLEAN: no data lost, sizes and menus correct, nothing slowed down'
      : (dataLoss.length ? 'DATA LOSS FOUND' : 'PROBLEMS FOUND (no data lost)')),
    seed: config.seed, sessions: config.sessions, seconds: Math.round((performance.now() - t0) / 100) / 10,
    dataLoss: dataLoss.slice(0, 30), dataLossCount: dataLoss.length,
    scrollJiggleEvents: scrollJiggles,
    editorSize: { checks: sizes.checks, widestEditorPx: sizes.widest, mostExtraHeightPx: sizes.taller, mostMissingHeightPx: sizes.shorter, problems: sizes.problems },
    menus: { checked: menus.checked, problems: menus.problems },
    slowingDown: { flagged: slower, perStep, heapGrowth, sessionEnds, stepsRunWhilePageHidden: hiddenRuns, note: 'steps that ran while the page was hidden are not counted in the timings' },
    otherFailures: failures.slice(0, 30), otherFailureCount: failures.length,
    steps: counts,
    editorSyncEvents: api.events().filter(event => ['stale-overlay-write', 'sync-mismatch', 'popup-write-mismatch', 'recovery-copy'].includes(event.ev)).length,
    samples,
    next: 'Reload the page and run spreadsheetSoakAfterReload().',
  };
  window.spreadsheetSoakReport = result;
  return result;
}

async function spreadsheetSoakAfterReload(options = {}) {
  const api = window.elabftwSpreadsheetDiagnostics;
  const stored = JSON.parse(sessionStorage.getItem('spreadsheetSoak') || 'null');
  if (!api || !stored) throw new Error('Nothing to check: run spreadsheetSoak() first, then reload.');
  await new Promise(resolve => setTimeout(resolve, 3000));
  const tables = api.snapshot(true);
  const mine = tables.slice(stored.baseline);
  const problems = [];
  if (mine.length !== stored.expected.length) problems.push({ problem: `${stored.expected.length} spreadsheets were saved, ${mine.length} came back` });
  stored.expected.forEach((expected, index) => {
    const have = mine[index]?.tableData;
    if (!have) { problems.push({ table: expected.label, problem: 'missing after reload' }); return; }
    // a well plate is stored as a plate, not as a grid of cell text: it only has to come back
    if (expected.plate) return;
    if (have.length !== expected.grid.length || (have[0]?.length ?? 0) !== (expected.grid[0]?.length ?? 0)) {
      problems.push({ table: expected.label, problem: `size ${have.length}x${have[0]?.length} instead of ${expected.grid.length}x${expected.grid[0]?.length}` });
      return;
    }
    for (let r = 0; r < expected.grid.length; r++) {
      for (let c = 0; c < expected.grid[r].length; c++) {
        if ((have[r][c] ?? '') !== expected.grid[r][c]) problems.push({ table: expected.label, cell: `${String.fromCharCode(65 + (c % 26))}${r + 1}`, expected: expected.grid[r][c], saved: have[r][c] ?? '' });
      }
    }
  });
  if (!options.keepTables && problems.length === 0) {
    mine.forEach(snap => api.removeTable(snap.uid));
    tinymce.activeEditor.execCommand('mceSave');
  }
  sessionStorage.removeItem('spreadsheetSoak');
  return { ok: problems.length === 0, dataLossAfterReload: problems.slice(0, 30), count: problems.length, scratchTablesRemoved: !options.keepTables && problems.length === 0 };
}
