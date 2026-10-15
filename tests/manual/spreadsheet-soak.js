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
    scenarios: ['plate-day', 'back-to-back', 'spaced-out', 'copy-paste', 'wide-plate', 'format-and-popup', 'enter-last-row', 'date-then-header', 'mixed'],
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
  const timed = async (name, fn) => {
    const start = performance.now();
    try { return await fn(); } finally { (timings[name] ||= []).push(Math.round(performance.now() - start)); }
  };
  const fail = (problem, extra = {}) => failures.push({ context, problem, ...extra });

  // ---- tables ---------------------------------------------------------------------------
  const tableEl = uid => editor.getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${uid}"]`);
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);
  const live = async uid => {
    const table = tableEl(uid);
    if (!table) throw new Error(`table ${uid} is missing`);
    table.scrollIntoView({ block: 'center' });
    await sleep(300);
    api.mountLive(uid);
    await sleep(450);
    return api.overlayElement(uid);
  };

  async function createTable(label, { rows = 5, cols = 4, plate = 0 } = {}) {
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
    // Enter in a cell of the last row adds a row below it (up to 50 rows).
    if (key === 'Enter' && r === model.grid.length - 1 && model.grid.length < 50) {
      model.grid.push(Array.from({ length: model.grid[0].length }, () => ''));
    }
    note(key === 'Enter' ? 'type-with-enter' : 'type-in-cell');
  }

  // The diagnostics drop trailing empty rows and columns, so the record is cut the same way.
  const trim = grid => {
    const rows = grid.map(row => row.slice());
    while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
    let width = 0;
    rows.forEach(row => { for (let i = row.length; i > 0; i--) if (row[i - 1] !== '') { width = Math.max(width, i); break; } });
    return rows.map(row => row.slice(0, width));
  };
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
      for (const check of api.verify('soak-check')) {
        if (!['ok', 'skipped'].includes(check.status) && models.has(check.uid)) fail(`editor reported ${check.status}`, { table: models.get(check.uid).label });
      }
    }
  }

  // ---- 2. editor size -------------------------------------------------------------------
  const lastSize = { frame: 0, content: 0 };
  async function measure(label) {
    await sleep(450);
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
        const root = await live(uid);
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
      if (!item) { fail('multi-delete menu item not found', { table: model.label }); await closeMenu(model.label, 'multi-delete'); return; }
      clickMenuItem(item);
      await sleep(700);
      doneMulti = true;
    });
    if (!doneMulti) return;
    // what the model should look like if the selection covered exactly the chosen range
    const snapshotNow = trim(api.snapshot(true).find(e => e.uid === uid)?.overlayData ?? []);
    const expectedRows = byRow ? model.grid.filter((_, i) => i < first || i > lastIdx) : model.grid.map(row => row.filter((_, i) => i < first || i > lastIdx));
    if (JSON.stringify(snapshotNow) === JSON.stringify(trim(expectedRows))) {
      model.grid = expectedRows;
    } else {
      // The selection may have covered a different range than asked: accept it only when it is
      // a pure removal of whole rows/columns; anything else is data loss.
      const removedWhole = byRow
        ? model.grid.some((_, skip) => false)
        : false;
      const candidates = [];
      const size2 = byRow ? model.grid.length : model.grid[0].length;
      for (let a = 0; a < size2; a++) for (let b = a; b < size2; b++) {
        candidates.push(byRow ? model.grid.filter((_, i) => i < a || i > b) : model.grid.map(row => row.filter((_, i) => i < a || i > b)));
      }
      const match = candidates.find(c => JSON.stringify(trim(c)) === JSON.stringify(snapshotNow));
      if (match && !removedWhole) { model.grid = match; note('multi-delete-different-range'); }
      else dataLoss.push({ context, table: model.label, problem: 'multi-delete left data that is not a whole-row/column removal', have: JSON.stringify(snapshotNow).slice(0, 160) });
      if (match === undefined) model.grid = expectedRows;
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
  }

  async function save() {
    note('save');
    await timed('save', async () => { editor.execCommand('mceSave'); await sleep(1100); });
  }

  const addText = async (text, count = 1) => {
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
      for (const el of [target, td, root]) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true }));
      }
      await sleep(300);
      const box = visibleRescue();
      const inCell = td.querySelector('input, textarea, [contenteditable=true]') || root.querySelector('.jss_editor input, .jss_editor textarea, td.editor');
      if (!box && !inCell) {
        fail(`clicking ${cellName(r, c)} and typing "${key}" did not start editing`, { table: model.label });
        continue;
      }
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
    const heights = [...root.querySelectorAll('.jss_worksheet tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height));
    note('row-height-check');
    if (heights.length && Math.max(...heights) - Math.min(...heights) > 1) {
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
  }

  // ---- scenarios ------------------------------------------------------------------------
  const scenarios = {
    async 'plate-day'() {
      const uid = await createTable('96-well plate', { plate: 96 });
      if (!uid) return;
      await verify('plate-day: inserted', true); await measure('plate-day: inserted');
      for (let i = 0; i < (config.quick ? 8 : 20); i++) {
        await typeInto(uid, int(0, 7), int(0, 11), `S${String(i + 1).padStart(2, '0')}`);
        if (i % 6 === 5) { await verify(`plate-day: ${i + 1} wells`, false); await measure('plate-day typing'); }
      }
      await popupEdit(uid, true, 3);
      await verify('plate-day: popup applied', true);
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
      for (const [r, c] of [[0, 0], [15, 23], [0, 23], [15, 0], [7, 11]]) await typeInto(uid, r, c, `W${r}-${c}`);
      await measure('wide-plate: typing');
      await verify('wide-plate: corners filled', true);
      await menuTour(uid);
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
      await typeInto(uid, model().grid.length - 1, 0, 'last-before-popup', 'Enter');
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
      const titleButton = () => [...document.querySelectorAll('.tox-split-button')].find(b => /experiment title/i.test(b.getAttribute('aria-label') || ''));
      const insertDate = async () => { dateButton().firstElementChild.click(); await sleep(450); };
      const expectKinds = (label, expected) => {
        const have = kinds();
        note(`header-${label}`);
        if (JSON.stringify(have) !== JSON.stringify(expected)) fail(`header under a date (${label}): expected ${expected.join(' ')} but found ${have.join(' ')}`, { html: body().innerHTML.replace(/<a class="elabftw-date-reference"[\s\S]*?<\/a>/g, '[date]').slice(0, 300) });
      };
      // This scenario needs a clean page, so what is on it is put aside and put back at the end.
      const savedContent = editor.getContent();
      const fresh = async html => { editor.setContent(html); editor.focus(); editor.selection.select(editor.getBody(), true); editor.selection.collapse(false); await sleep(250); };

      // 1. empty page: date, then the paragraph that follows becomes a Heading 2
      await fresh('');
      await insertDate();
      editor.execCommand('mceToggleFormat', false, 'h2'); editor.insertContent('Header'); await sleep(250);
      expectKinds('date then Heading 2 in the line below', ['DATE', 'H2']);
      // 2. date, then the Insert title button
      await fresh('');
      await insertDate();
      titleButton().firstElementChild.click(); await sleep(500);
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
      await sleep(900);
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
          if (roll < 0.40) { name = 'type'; await typeInto(uid, int(0, model.grid.length - 1), int(0, model.grid[0].length - 1), random() < 0.2 ? `=${cellName(0, 0)}+1` : String(int(0, 999))); }
          else if (roll < 0.50) { name = 'scroll'; await scrollCheck(`mixed round ${round}`); await live(uid); }
          else if (roll < 0.62) { name = 'popup-apply'; await popupEdit(uid, true, int(1, 2)); }
          else if (roll < 0.70) { name = 'popup-cancel'; await popupEdit(uid, false, 1); }
          else if (roll < 0.76) { name = 'multi-delete'; await multiDelete(uid); }
          else if (roll < 0.82) { name = 'rows-columns'; await structureOp(uid); }
          else if (roll < 0.90) { name = 'menu'; await menuTour(uid); }
          else { name = 'save'; await save(); }
        } catch (error) {
          fail(`${name}: ${error && error.message || error}`);
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
      window.spreadsheetSoakProgress = { session, sessions: config.sessions, scenario: name, dataLoss: dataLoss.length, failures: failures.length };
      try { await scenarios[name](); } catch (error) { fail(`${name} stopped: ${error && error.message || error}`); }
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

  const result = {
    verdict: dataLoss.length === 0 && failures.length === 0 && sizes.problems.length === 0 && menus.problems.length === 0 && slower.length === 0
      ? 'CLEAN: no data lost, sizes and menus correct, nothing slowed down'
      : (dataLoss.length ? 'DATA LOSS FOUND' : 'PROBLEMS FOUND (no data lost)'),
    seed: config.seed, sessions: config.sessions, seconds: Math.round((performance.now() - t0) / 100) / 10,
    dataLoss: dataLoss.slice(0, 30), dataLossCount: dataLoss.length,
    scrollJiggleEvents: scrollJiggles,
    editorSize: { checks: sizes.checks, widestEditorPx: sizes.widest, mostExtraHeightPx: sizes.taller, mostMissingHeightPx: sizes.shorter, problems: sizes.problems },
    menus: { checked: menus.checked, problems: menus.problems },
    slowingDown: { flagged: slower, perStep, heapGrowth, sessionEnds },
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
