/**
 * Stress test for the inline grid <-> popup <-> saved table synchronisation.
 *
 * Run it from the browser console on an experiment's EDIT page (you must be logged in):
 * paste this file, then
 *
 *     const report = await spreadsheetSyncStress({ seed: 1, rounds: 60 });
 *     console.log(JSON.stringify(report, null, 2));
 *
 * (A long run can also be started without waiting: spreadsheetSyncStress({...}); then read
 * window.spreadsheetSyncStressProgress while it runs and window.spreadsheetSyncStressReport
 * when it is done.)
 *
 * It adds a scratch spreadsheet at the end of the text, then repeats random operations
 * (inline edits at varied delays, scrolling the table away and back, opening the popup and
 * applying or cancelling it, saving) while keeping its own model of what every cell must hold.
 * After each step it compares the model with the grid and, once the debounce has settled, with
 * the real table. Mismatches, plus the sync warnings the editor itself raised, are reported.
 *
 * Afterwards (reload the page, then):
 *
 *     const after = await spreadsheetSyncStressAfterReload();
 *
 * compares the model with what was saved, then removes the scratch table. Add
 * { keepTable: true } to keep it.
 *
 * Only cell values go through the model that this script holds; the editor's own diagnostics
 * (events, revisions, hashes) never contain cell values.
 */
async function spreadsheetSyncStress(options = {}) {
  const config = { seed: 1, rounds: 60, rows: 5, cols: 4, settleMs: 900, ...options };
  const api = window.elabftwSpreadsheetDiagnostics;
  if (!api) throw new Error('The spreadsheet diagnostics are not loaded: open an experiment in edit mode.');
  const editor = tinymce.activeEditor;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frames = n => new Promise(resolve => { let i = 0; const tick = () => (++i >= n ? resolve() : requestAnimationFrame(tick)); tick(); });

  // Small seeded generator so a failing run can be repeated exactly.
  let state = config.seed >>> 0 || 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const pick = list => list[Math.floor(random() * list.length)];
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));

  const originalConfirm = window.confirm;
  window.confirm = () => true;
  const failures = [];
  const counts = {};
  const note = op => { counts[op] = (counts[op] || 0) + 1; };
  const t0 = performance.now();
  const eventsBefore = api.events().length;

  const uid = api.insertScratch(config.rows, config.cols);
  if (!uid) throw new Error('Could not insert the scratch spreadsheet.');
  await sleep(800);

  // The model: raw cell text exactly as it was typed.
  const model = Array.from({ length: config.rows }, () => Array.from({ length: config.cols }, () => ''));
  const cellName = (r, c) => String.fromCharCode(65 + c) + (r + 1);

  const tableEl = () => editor.getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${uid}"]`);
  const bringIntoView = async () => {
    const table = tableEl();
    table.scrollIntoView({ block: 'center' });
    await sleep(350);
    api.mountLive(uid);
    await sleep(500);
  };
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);

  async function editCell(root, r, c, value) {
    const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    if (!td) throw new Error(`cell ${cellName(r, c)} not found`);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
    }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box) throw new Error(`no cell editor opened for ${cellName(r, c)}`);
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await frames(2);
  }

  // settle=false: only the grid is compared (the table legitimately trails it by the editor's
  // 500 ms write delay). settle=true: the table and the editor's own sync check as well.
  const compare = async (label, { settle }) => {
    if (settle) await sleep(config.settleMs);
    const snap = api.snapshot(true).find(entry => entry.uid === uid);
    if (!snap) { failures.push({ label, problem: 'scratch table missing' }); return; }
    const norm = grid => {
      const rows = grid.map(row => row.slice());
      return rows;
    };
    const expected = norm(model);
    const wrong = (name, grid) => {
      if (!grid) return;
      for (let r = 0; r < config.rows; r++) {
        for (let c = 0; c < config.cols; c++) {
          const have = grid[r]?.[c] ?? '';
          if (have !== expected[r][c]) {
            failures.push({ label, where: name, cell: cellName(r, c), expected: expected[r][c], have });
          }
        }
      }
    };
    if (snap.live && !snap.editing) wrong('grid', snap.overlayData);
    if (!settle) return;
    wrong('table', snap.tableData);
    for (const check of api.verify('stress-check')) {
      if (check.uid === uid && !['ok', 'skipped'].includes(check.status)) {
        failures.push({ label, problem: `editor reported ${check.status}` });
      }
    }
  };

  const ops = {
    async inline() {
      note('inline-edit');
      await bringIntoView();
      const r = int(0, config.rows - 1); const c = int(0, config.cols - 1);
      let value = String(int(0, 999));
      if (random() < 0.25) {
        // A formula pointing at some other cell (never itself).
        let rr = r; let cc = c;
        while (rr === r && cc === c) { rr = int(0, config.rows - 1); cc = int(0, config.cols - 1); }
        value = `=${cellName(rr, cc)}+1`;
      }
      await editCell(api.overlayElement(uid), r, c, value);
      model[r][c] = value;
    },
    async scrollAway() {
      note('scroll-away-and-back');
      window.scrollTo(0, 0);
      await sleep(int(200, 900));
      await bringIntoView();
    },
    async popup(applyIt, edits) {
      note(applyIt ? 'popup-apply' : (edits ? 'popup-edit-cancel' : 'popup-open-cancel'));
      await bringIntoView();
      const button = api.overlayElement(uid)?.querySelector('.elabftw-spreadsheet-readonly-open-editor');
      if (!button) throw new Error('open-editor button not found');
      button.click();
      let dialog = null;
      for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
      if (!dialog) throw new Error('popup did not open');
      await sleep(400);
      const staged = [];
      for (let i = 0; i < edits; i++) {
        const r = int(0, config.rows - 1); const c = int(0, config.cols - 1); const value = String(int(1000, 1999));
        await editCell(dialog, r, c, value);
        staged.push([r, c, value]);
      }
      const label = applyIt ? /^(Update|Insert)/ : /^Cancel/;
      const target = [...dialog.querySelectorAll('button')].find(b => label.test(b.textContent.trim()));
      if (!target) throw new Error('popup button not found');
      target.click();
      for (let i = 0; i < 60 && document.querySelector('.inline-spreadsheet-dialog'); i++) await sleep(50);
      if (applyIt) staged.forEach(([r, c, value]) => { model[r][c] = value; });
    },
    async save() {
      note('save');
      editor.execCommand('mceSave');
      await sleep(1200);
    },
    // An edit followed at once by a read of the content (what a save does): the table inside
    // the editor must already hold the edit, even though the write delay has not elapsed.
    async editThenReadNow() {
      note('edit-then-read-content-now');
      await bringIntoView();
      const r = int(0, config.rows - 1); const c = int(0, config.cols - 1); const value = String(int(2000, 2999));
      await editCell(api.overlayElement(uid), r, c, value);
      model[r][c] = value;
      const html = editor.getContent();
      const snap = api.snapshot(true).find(entry => entry.uid === uid);
      if ((snap.tableData[r]?.[c] ?? '') !== value) {
        failures.push({ label: 'edit then immediate content read', problem: `table lacked the edit in ${cellName(r, c)}` });
      }
      if (!html.includes(value)) failures.push({ label: 'edit then immediate content read', problem: 'the saved text does not contain the edit' });
    },
  };

  const delays = [0, 0, 30, 120, 450, 520, 700, 1500];
  for (let round = 1; round <= config.rounds; round++) {
    const roll = random();
    let name;
    try {
      if (roll < 0.45) { name = 'inline'; await ops.inline(); }
      else if (roll < 0.55) { name = 'edit-then-read'; await ops.editThenReadNow(); }
      else if (roll < 0.65) { name = 'scrollAway'; await ops.scrollAway(); }
      else if (roll < 0.77) { name = 'popup-apply'; await ops.popup(true, int(1, 2)); }
      else if (roll < 0.85) { name = 'popup-edit-cancel'; await ops.popup(false, 1); }
      else if (roll < 0.92) { name = 'popup-open-cancel'; await ops.popup(false, 0); }
      else { name = 'save'; await ops.save(); }
    } catch (error) {
      failures.push({ label: `round ${round} ${name}`, problem: String(error && error.message || error) });
    }
    await sleep(pick(delays));
    window.spreadsheetSyncStressProgress = { round, rounds: config.rounds, failures: failures.length, lastOperation: name };
    // Quick compare of the grid each round; the table is compared once things settle.
    await compare(`round ${round} ${name} (grid)`, { settle: false });
    if (round % 8 === 0) await compare(`round ${round} settled`, { settle: true });
  }
  await compare('final settled', { settle: true });
  await ops.save();
  await compare('after final save', { settle: true });

  window.confirm = originalConfirm;
  sessionStorage.setItem('spreadsheetSyncStress', JSON.stringify({ uid, model, at: Date.now() }));

  const events = api.events().slice(eventsBefore);
  const summary = {};
  events.forEach(event => { summary[event.ev] = (summary[event.ev] || 0) + 1; });
  const problems = events.filter(event => ['stale-overlay-write', 'sync-mismatch', 'popup-write-mismatch', 'recovery-copy'].includes(event.ev));
  const result = {
    ok: failures.length === 0 && problems.length === 0,
    seed: config.seed,
    rounds: config.rounds,
    operations: counts,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
    failures: [...failures.filter(f => f.problem).slice(0, 20), ...failures.filter(f => !f.problem).slice(0, 20)],
    failureCount: failures.length,
    editorSyncEvents: problems,
    eventSummary: summary,
    scratchTable: uid,
    next: 'Reload the page and run spreadsheetSyncStressAfterReload().',
  };
  // Long runs outlast many tools' time limit: the report is also kept here.
  window.spreadsheetSyncStressReport = result;
  return result;
}

async function spreadsheetSyncStressAfterReload(options = {}) {
  const api = window.elabftwSpreadsheetDiagnostics;
  const stored = JSON.parse(sessionStorage.getItem('spreadsheetSyncStress') || 'null');
  if (!api || !stored) throw new Error('Nothing to check: run spreadsheetSyncStress() first, then reload.');
  await new Promise(resolve => setTimeout(resolve, 2500));
  // Table ids are not kept in the saved text, so find the scratch table by its content: the
  // saved table with the fewest differences from the model.
  const snaps = api.snapshot(true);
  const differences = entry => {
    let count = 0;
    for (let r = 0; r < stored.model.length; r++) {
      for (let c = 0; c < stored.model[r].length; c++) if ((entry.tableData[r]?.[c] ?? '') !== stored.model[r][c]) count++;
    }
    return count;
  };
  const snap = snaps.sort((a, b) => differences(a) - differences(b))[0];
  const mismatches = [];
  if (!snap || differences(snap) > stored.model.length * stored.model[0].length / 2) {
    mismatches.push({ problem: 'the scratch table was not saved' });
  } else {
    for (let r = 0; r < stored.model.length; r++) {
      for (let c = 0; c < stored.model[r].length; c++) {
        const have = snap.tableData[r]?.[c] ?? '';
        if (have !== stored.model[r][c]) mismatches.push({ cell: String.fromCharCode(65 + c) + (r + 1), expected: stored.model[r][c], saved: have });
      }
    }
  }
  if (snap && !options.keepTable && mismatches.every(m => !m.problem)) {
    api.removeTable(snap.uid);
    tinymce.activeEditor.execCommand('mceSave');
  }
  sessionStorage.removeItem('spreadsheetSyncStress');
  return { ok: mismatches.length === 0, mismatches, scratchTableRemoved: !!snap && !options.keepTable && mismatches.every(m => !m.problem) };
}
