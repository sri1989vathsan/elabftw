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
    scenarios: ['plate-day', 'back-to-back', 'spaced-out', 'copy-paste', 'wide-plate', 'format-and-popup', 'enter-last-row', 'multi-delete', 'date-then-header', 'type-then-resize', 'enter-semantics', 'tab-then-type', 'sink-text', 'format-after-typing', 'filler-click', 'autosave-in-grid', 'popup-direct-typing', 'paste-external', 'undo-redo', 'copy-table-format', 'border-neighbors', 'drag-select', 'mixed'],
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
  const note = name => { counts[name] = (counts[name] || 0) + 1; };
  const t0 = performance.now();
  window.spreadsheetSoakLive = { dataLoss, failures, sizes, menus };
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
    // Tab by default: it moves on without changing the grid. Enter in a cell of the last row adds a row.
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
    // Enter commits and stays in the cell; only a second Enter (see enterAgain) moves down or adds a row.
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
      if (sel.length !== 1 || sel[0][0] !== c || sel[0][1] !== r) dataLoss.push({ context, table: model.label, problem: `Enter in ${cellName(r, c)} should keep the cursor there, it is on ${JSON.stringify(sel)}` });
    }
    return true;
  }
  // A second Enter with the cell only selected: down one cell, and a new row at the last row.
  async function enterAgain(uid) {
    const model = models.get(uid);
    const root = await live(uid);
    const before = selectedCells(root);
    if (before.length !== 1) { fail('enterAgain needs one selected cell', { table: model.label, selected: before }); return; }
    const [c, r] = before[0];
    const last = r === model.grid.length - 1;
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(500);
    const after = selectedCells(api.overlayElement(uid) || root);
    if (last && model.grid.length < 50) model.grid.push(blankRow(model.grid[0].length));
    const wantRow = last && model.grid.length - 1 > r ? r + 1 : Math.min(r + 1, model.grid.length - 1);
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
    const cols = model.grid[0].length;
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
            if (have !== expected) dataLoss.push({ context, table: model.label, where, cell: cellName(r, c), expected, have });
          }
        }
      };
      const dom = tableEl(uid);
      if (dom && settle && (dom.rows.length - 1 !== model.grid.length || dom.rows[0].cells.length - 1 !== model.grid[0].length)) {
        dataLoss.push({ context, table: model.label, where: 'saved table', problem: `size ${dom.rows.length - 1}x${dom.rows[0].cells.length - 1} instead of ${model.grid.length}x${model.grid[0].length}` });
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
    if (extra < -6) problems.push(`editor is ${-extra} px shorter than its content (cut off)`);
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
  async function structureOp(uid) {
    const model = models.get(uid);
    if (model.plate) return;
    const rows = model.grid.length; const cols = model.grid[0].length;
    const kind = pick(['row-after', 'row-before', 'col-after', 'col-before', 'del-row', 'del-col']);
    if ((kind === 'del-row' && rows <= 2) || (kind === 'del-col' && cols <= 2)) return;
    if ((kind.startsWith('row') && rows >= 14) || (kind.startsWith('col') && cols >= 10)) return;
    const r = int(0, rows - 1); const c = int(0, cols - 1);
    note(`menu-${kind}`);
    // Size of the stored table (it follows the live grid a moment after each change).
    const domSize = () => { const t = tableEl(uid); return [t.rows.length - 1, t.rows[0].cells.length - 1]; };
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
    const baseline = positions();
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
        if (Math.abs(frame - frameBase) > 2) stops.push({ y, problem: `editor height changed from ${frameBase} to ${frame} px while scrolling` });
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
    let matched = null;
    for (let a1 = 0; a1 < size2 && !matched; a1++) for (let b1 = a1; b1 < size2 && !matched; b1++) {
      if (exact(without(a1, b1), normalizedNow)) matched = [a1, b1];
    }
    note('multi-delete-checked');
    if (matched) {
      if (matched[0] !== first || matched[1] !== lastIdx) note('multi-delete-different-range');
      model.grid = without(matched[0], matched[1]);
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
    await timed('paste-table', async () => { editor.insertContent(html); await sleep(900); });
    note(spaced ? 'paste-spaced' : 'paste-right-after');
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
  const findButton = (root, labels) => [...root.querySelectorAll('button, [title], [aria-label]')]
    .find(b => labels.includes(b.title) || labels.includes(b.getAttribute('aria-label')));
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

  // Rows added by the Add rows button, Enter in the last row or the menu must be as tall as the others
  // (they were 4 px shorter once, because the row-number cell of a new row had no padding).
  async function rowHeightsUniform(uid, label) {
    const root = api.overlayElement(uid);
    if (!root) return;
    await sleep(500);
    if (document.hidden) { note('row-height-check-skipped-hidden'); return; } // the layout loop is throttled then
    const heights = [...root.querySelectorAll('.jss_worksheet tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height));
    note('row-height-check');
    // rows with and without content can differ by 3 px in the table's own rendering
    if (heights.length && Math.max(...heights) - Math.min(...heights) > 4) {
      fail(`rows are not all the same height after ${label}: ${heights.join(' ')}`, { table: models.get(uid)?.label });
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
  const plateCheck = async (uid, context) => {
    const root = await live(uid);
    const model = models.get(uid);
    if (!root || !model) return;
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
  const scenarios = {
    async 'plate-day'() {
      const uid = await createTable('96-well plate', { plate: 96 });
      if (!uid) return;
      await verify('plate-day: inserted', true); await measure('plate-day: inserted');
      await plateCheck(uid, 'plate-day: inserted');
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
      for (const uid of made) await menuTour(uid);
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
    // Typing with Enter in the last row adds rows; typed values must survive that, and survive a row/column
    // insert or delete done right after typing (before the grid has been redrawn). Data was lost here once:
    // values typed through the editor box exist only in the editor's own copy until a redraw.
    async 'enter-last-row'() {
      const uid = await createTable('enter table', { rows: 3, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      for (let i = 0; i < 10; i++) {
        const last = model().grid.length - 1;
        await typeInto(uid, last, int(0, model().grid[0].length - 1), `E${i + 1}`, 'Enter');
        await enterAgain(uid); // the second Enter, on the last row, adds the row
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
    // Enter commits and stays; a second Enter moves down; at the last row it adds a row.
    async 'enter-semantics'() {
      const uid = await createTable('enter semantics', { rows: 4, cols: 3 });
      if (!uid) return;
      const model = () => models.get(uid);
      await typeDirect(uid, 1, 1, 'mid', 'Enter');
      await enterAgain(uid);
      await enterAgain(uid);
      await verify('enter-semantics: moved down', true);
      for (let i = 0; i < 4; i++) await enterAgain(uid);
      await verify('enter-semantics: rows added by Enter', true);
      verticalAlignCheck(uid, 'rows added by Enter');
      await typeDirect(uid, model().grid.length - 1, 2, 'tail', 'Enter');
      await typeDirect(uid, 0, 0, 'tabbed', 'Tab');
      await verify('enter-semantics: typed after growing', true);
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
    // Typing straight over cells in the popup: Enter stays, a second Enter moves down / adds a row, Update keeps all.
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
        if (sel.length !== 1 || sel[0][0] !== c || sel[0][1] !== r) dataLoss.push({ context, table: model().label, where: 'popup', problem: `Enter in ${cellName(r, c)} should keep the cursor there, it is on ${JSON.stringify(sel)}` });
        if (popupCell(c, r).textContent.trim() !== value) dataLoss.push({ context, table: model().label, where: 'popup', cell: cellName(r, c), expected: value, have: popupCell(c, r).textContent.trim() });
        note('popup-type-direct');
        return true;
      };
      await typeInPopup(1, 1, 'pp1');
      (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(500);
      const sel = popupSelected();
      if (sel.length !== 1 || sel[0][0] !== 1 || sel[0][1] !== 2) dataLoss.push({ context, where: 'popup', problem: `a second Enter should select B3 in the popup, selection is ${JSON.stringify(sel)}` });
      await typeInPopup(2, 0, 'pp2');
      const lastRow = dialog.querySelectorAll('.jss_worksheet tbody tr').length - 1;
      press(popupCell(0, lastRow)); await sleep(300);
      (document.activeElement || dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(900);
      const rowsNow = dialog.querySelectorAll('.jss_worksheet tbody tr').length;
      if (rowsNow !== lastRow + 2) dataLoss.push({ context, where: 'popup', problem: `a second Enter on the last row should add a row (${lastRow + 1} to ${lastRow + 2}), there are ${rowsNow}` });
      model().grid.push(blankRow(model().grid[0].length));
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
    // A border colour on a cell must show on every edge of it, also those the neighbour would otherwise win.
    async 'border-neighbors'() {
      const uid = await createTable('border table', { rows: 5, cols: 5 });
      if (!uid) return;
      await typeInto(uid, 2, 2, 'mid');
      const dialog = await openPopupFor(uid);
      const cellAt = (c, r) => dialog.querySelector(`.jss_worksheet td[data-x="${c}"][data-y="${r}"]`);
      press(cellAt(2, 2)); await sleep(350);
      const colour = [...dialog.querySelectorAll('input[type="color"]')].find(input => /selected cell border/i.test(`${input.title} ${input.getAttribute('aria-label')} ${input.closest('[title]')?.title || ''} ${input.closest('[aria-label]')?.getAttribute('aria-label') || ''}`));
      if (!colour) { fail('the popup has no border colour control'); const x = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel'); x && x.click(); await waitPopupGone(); return; }
      colour.value = '#ff0000'; colour.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1000);
      const red = 'rgb(255, 0, 0)';
      const edge = (c, r, side) => getComputedStyle(cellAt(c, r))[`border${side}Color`];
      const checks = [['the cell itself, top', edge(2, 2, 'Top')], ['the cell itself, left', edge(2, 2, 'Left')], ['the cell itself, bottom', edge(2, 2, 'Bottom')], ['the cell itself, right', edge(2, 2, 'Right')], ['the cell to the left (its right edge)', edge(1, 2, 'Right')], ['the cell above (its bottom edge)', edge(2, 1, 'Bottom')]];
      checks.forEach(([where, got]) => { if (got !== red) dataLoss.push({ context, where: 'popup', problem: `border colour on ${where} is ${got}, expected ${red}` }); });
      note('border-colour');
      if (cellAt(2, 2).textContent.trim() !== 'mid') dataLoss.push({ context, where: 'popup', problem: 'the cell value changed while formatting' });
      const update = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update');
      if (update) { update.click(); await waitPopupGone(); }
      await sleep(config.settleMs);
      const table = tableEl(uid);
      const savedEdge = (r, c, side) => getComputedStyle(table.rows[r + 1].cells[c + 1])[`border${side}Color`];
      [['saved table, the cell, top', savedEdge(2, 2, 'Top')], ['saved table, the cell to the left (right edge)', savedEdge(2, 1, 'Right')], ['saved table, the cell above (bottom edge)', savedEdge(1, 2, 'Bottom')]].forEach(([where, got]) => { if (got !== red) dataLoss.push({ context, where, problem: `border colour is ${got}, expected ${red}` }); });
      await verify('border-neighbors: values unchanged', true);
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
          expected: api.snapshot(true).filter(snap => models.has(snap.uid)).map(snap => ({ label: models.get(snap.uid).label, grid: models.get(snap.uid).grid })),
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
        expected: order.filter(snap => models.has(snap.uid)).map(snap => ({ label: models.get(snap.uid).label, grid: models.get(snap.uid).grid })),
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
