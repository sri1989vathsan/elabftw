/**
 * Speed test for the spreadsheet editor, with the sync checks switched on and off.
 *
 * Run from the browser console on an experiment's EDIT page (logged in), after pasting this file:
 *
 *     const report = await spreadsheetPerf.compare({ tables: 30, rounds: 3 });
 *     console.log(JSON.stringify(report, null, 2));
 *
 * It adds scratch tables (removed again at the end), repeats the same workload with the checks ON
 * and OFF (alternating, so slow drift in the browser affects both the same), and reports medians:
 * reading the content (what a save does), the delay between pressing Enter in a cell and the
 * table holding the value, opening and applying the popup, the time the page spent blocked
 * (long tasks), frame times while scrolling, and the time the checks themselves used.
 *
 * Options: tables (extra small tables, default 25), bigRows/bigCols (a big table, 0 for none),
 * rounds (default 3). A long run can be started without waiting: read spreadsheetPerf.progress and
 * spreadsheetPerf.report.
 */
window.spreadsheetPerf = (() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const api = () => window.elabftwSpreadsheetDiagnostics;
  const editor = () => tinymce.activeEditor;
  // A hidden or background browser tab does not fire animation frames, so waiting for one could
  // wait forever. This gives up after 120 ms; frame timings are then reported as null.
  const nextFrame = () => new Promise(resolve => {
    let fired = false;
    requestAnimationFrame(() => { fired = true; resolve(true); });
    setTimeout(() => { if (!fired) resolve(false); }, 120);
  });
  const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  const round = n => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
  const percentile = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null; };

  const self = { progress: null, report: null };

  // Memory and size of the page right now. heapMB needs Chromium (performance.memory); in Firefox
  // it is null, so use about:memory or the Memory tab there.
  const memory = () => ({
    heapMB: performance.memory ? round(performance.memory.usedJSHeapSize / 1048576) : null,
    domNodes: document.getElementsByTagName('*').length + (editor().getDoc()?.getElementsByTagName('*').length ?? 0),
    overlays: document.querySelectorAll('.elabftw-spreadsheet-editor-overlay').length,
    liveGrids: [...document.querySelectorAll('.elabftw-spreadsheet-editor-overlay')].filter(el => !el.classList.contains('elabftw-spreadsheet-preview')).length,
    checkLogEvents: api().events().length,
    recoveryCopies: api().recoveryCopies().length,
  });
  self.memory = memory;

  // How long the page took to get ready, and what the checks cost while it loaded. Run on a freshly
  // loaded page (the numbers are since the page started).
  self.loadReport = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      tables: api().snapshot().length,
      memory: memory(),
      timeUsedByTheChecksSincePageStart: api().overhead(),
    };
  };

  // Repeats actions that create and throw away a grid or a popup and watches whether memory keeps
  // growing. Growth that does not level off points to a leak.
  self.leakTest = async (cycles = 24, uid = null) => {
    window.confirm = () => true;
    const own = uid === null;
    const target = uid ?? api().insertScratch(5, 4);
    await sleep(1000);
    const table = () => editor().getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${target}"]`);
    const samples = [];
    for (let i = 1; i <= cycles; i++) {
      table().scrollIntoView({ block: 'center' });
      await sleep(300);
      api().mountLive(target);
      await sleep(400);
      api().overlayElement(target).querySelector('.elabftw-spreadsheet-readonly-open-editor').click();
      let dialog = null;
      for (let waited = 0; waited < 6000 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); waited += 25) await sleep(25);
      await sleep(300);
      [...dialog.querySelectorAll('button')].find(b => /^Cancel/.test(b.textContent.trim())).click();
      await sleep(500);
      window.scrollTo(0, 0);
      await sleep(500);
      if (i % 4 === 0) samples.push({ cycle: i, ...memory() });
    }
    if (own) { api().removeTable(target); editor().execCommand('mceSave'); }
    const heap = samples.map(entry => entry.heapMB).filter(Number.isFinite);
    const avg = list => list.reduce((sum, v) => sum + v, 0) / (list.length || 1);
    return {
      cycles,
      samples: samples.map(entry => ({ cycle: entry.cycle, heapMB: entry.heapMB, domNodes: entry.domNodes, overlays: entry.overlays, liveGrids: entry.liveGrids })),
      heapGrowthFirstToLastThirdMB: heap.length >= 6 ? round(avg(heap.slice(-Math.ceil(heap.length / 3))) - avg(heap.slice(0, Math.ceil(heap.length / 3)))) : null,
      note: 'Heap numbers wobble between garbage collections; a steady climb over all samples, or growing overlays/domNodes, is the sign of a leak.',
    };
  };

  async function editCell(root, r, c, value) {
    const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    let box = null;
    for (let i = 0; i < 80 && !(box = [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden)); i++) await sleep(10);
    if (!box) throw new Error('no cell editor');
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }

  async function workload(uid, big) {
    const out = { contentReadMs: [], commitMs: [], popupOpenMs: [], popupApplyMs: [], frameMs: [], longTaskMs: 0 };
    const table = () => editor().getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${uid}"]`);
    const overlay = () => api().overlayElement(uid);
    const snapshot = () => api().snapshot(true).find(entry => entry.uid === uid);
    table().scrollIntoView({ block: 'center' });
    await sleep(500);
    api().mountLive(uid);
    await sleep(big ? 4000 : 800);

    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
      observer.observe({ entryTypes: ['longtask'] });
    } catch (error) { /* not supported: reported as null */ }

    for (let i = 0; i < (big ? 4 : 12); i++) {
      const started = performance.now();
      editor().getContent();
      out.contentReadMs.push(performance.now() - started);
    }

    const edits = big ? 4 : 10;
    for (let i = 0; i < edits; i++) {
      const value = `v${i}-${Math.floor(Math.random() * 1e6)}`;
      const r = i % 5; const c = i % 4;
      const started = performance.now();
      await editCell(overlay(), r, c, value);
      let done = false;
      for (let waited = 0; waited < 3000 && !done; waited += 20) {
        await sleep(20);
        done = JSON.stringify(snapshot().tableData).includes(value);
      }
      out.commitMs.push(done ? performance.now() - started : NaN);
      await sleep(150);
    }

    for (let i = 0; i < (big ? 2 : 4); i++) {
      table().scrollIntoView({ block: 'center' });
      await sleep(400);
      const button = overlay().querySelector('.elabftw-spreadsheet-readonly-open-editor');
      const opened = performance.now();
      button.click();
      let dialog = null;
      for (let waited = 0; waited < 8000; waited += 20) {
        dialog = document.querySelector('.inline-spreadsheet-dialog');
        if (dialog && dialog.querySelector('td[data-x="0"][data-y="0"]')) break;
        await sleep(20);
      }
      out.popupOpenMs.push(performance.now() - opened);
      await sleep(400);
      await editCell(dialog, 1, 1, `p${i}`);
      await sleep(150);
      const update = [...dialog.querySelectorAll('button')].find(b => /^Update/.test(b.textContent.trim()));
      const applied = performance.now();
      update.click();
      for (let waited = 0; waited < 8000 && document.querySelector('.inline-spreadsheet-dialog'); waited += 20) await sleep(20);
      out.popupApplyMs.push(performance.now() - applied);
      await sleep(900);
    }

    // Frame times while scrolling the page up and down.
    window.scrollTo(0, 0);
    await sleep(500);
    let last = performance.now();
    for (let i = 0; i < 80; i++) {
      window.scrollBy(0, i < 40 ? 60 : -60);
      const fired = await nextFrame();
      const now = performance.now();
      if (fired) out.frameMs.push(now - last);
      last = now;
    }
    if (observer) { observer.disconnect(); out.longTaskMs = longTasks.reduce((sum, d) => sum + d, 0); } else { out.longTaskMs = null; }
    return out;
  }

  const summarise = list => ({
    contentReadMs: round(median(list.flatMap(r => r.contentReadMs))),
    commitMs: round(median(list.flatMap(r => r.commitMs).filter(Number.isFinite))),
    popupOpenMs: round(median(list.flatMap(r => r.popupOpenMs))),
    popupApplyMs: round(median(list.flatMap(r => r.popupApplyMs))),
    frameMedianMs: round(median(list.flatMap(r => r.frameMs))),
    frameP95Ms: round(percentile(list.flatMap(r => r.frameMs), 0.95)),
    longTaskMsPerRun: round(median(list.map(r => r.longTaskMs).filter(Number.isFinite))),
  });

  // The same number of ordinary HTML tables versus spreadsheet tables, same size, in the same page.
  // A spreadsheet table is a plain table plus the grid, so the difference is what the grid costs.
  // Options: tables (default 30), rows (5), cols (4), rounds (2).
  self.compareWithPlainHtml = async (options = {}) => {
    const config = { tables: 30, rows: 5, cols: 4, rounds: 2, ...options };
    const ed = editor();
    const plainHtml = () => {
      const body = Array.from({ length: config.rows }, (_, r) => `<tr>${Array.from({ length: config.cols }, (_, c) => `<td>${r * config.cols + c}</td>`).join('')}</tr>`).join('');
      return `<table class="perf-plain" border="1"><tbody>${body}</tbody></table><p>&nbsp;</p>`;
    };
    const frames = async () => {
      window.scrollTo(0, 0);
      await sleep(500);
      const times = []; let last = performance.now();
      for (let i = 0; i < 80; i++) {
        window.scrollBy(0, i < 40 ? 120 : -120);
        const fired = await nextFrame();
        const now = performance.now(); if (fired) times.push(now - last); last = now;
      }
      return times;
    };
    const measure = async (label, add, remove) => {
      const before = memory();
      const t0 = performance.now();
      const handles = add();
      await sleep(3000);
      const settleMs = performance.now() - t0 - 3000;
      const after = memory();
      const reads = []; for (let i = 0; i < 10; i++) { const s = performance.now(); ed.getContent(); reads.push(performance.now() - s); }
      const frameTimes = await frames();
      const result = {
        label,
        heapGrowthMB: after.heapMB !== null && before.heapMB !== null ? round(after.heapMB - before.heapMB) : null,
        domNodesAdded: after.domNodes - before.domNodes,
        liveGridsAfter: after.liveGrids, overlaysAfter: after.overlays,
        contentReadMs: round(median(reads)),
        frameMedianMs: round(median(frameTimes)), frameP95Ms: round(percentile(frameTimes, 0.95)),
        insertMs: round(settleMs < 0 ? 0 : settleMs),
      };
      remove(handles);
      await sleep(1500);
      return result;
    };
    const plainAdd = () => { for (let i = 0; i < config.tables; i++) ed.selection.select(ed.getBody(), true), ed.selection.collapse(false), ed.execCommand('mceInsertContent', false, plainHtml()); return null; };
    const plainRemove = () => { ed.getBody().querySelectorAll('table.perf-plain').forEach(table => table.nextElementSibling?.tagName === 'P' && table.nextElementSibling.remove()); ed.getBody().querySelectorAll('table.perf-plain').forEach(table => ed.dom.remove(table)); };
    const sheetAdd = () => Array.from({ length: config.tables }, () => api().insertScratch(config.rows, config.cols));
    const sheetRemove = uids => uids.forEach(uid => api().removeTable(uid));
    const runs = { plain: [], spreadsheet: [] };
    self.progress = { step: 'baseline' };
    const baseline = memory();
    for (let round = 1; round <= config.rounds; round++) {
      for (const kind of (round % 2 ? ['plain', 'spreadsheet'] : ['spreadsheet', 'plain'])) {
        self.progress = { round, kind };
        runs[kind].push(kind === 'plain' ? await measure('plain', plainAdd, plainRemove) : await measure('spreadsheet', sheetAdd, sheetRemove));
      }
    }
    ed.execCommand('mceSave');
    const avg = (kind, key) => round(median(runs[kind].map(r => r[key]).filter(Number.isFinite)));
    const keys = ['heapGrowthMB', 'domNodesAdded', 'liveGridsAfter', 'contentReadMs', 'frameMedianMs', 'frameP95Ms'];
    const summary = { plainHtml: {}, spreadsheet: {}, spreadsheetMinusPlain: {}, perTableExtra: {} };
    keys.forEach(key => {
      summary.plainHtml[key] = avg('plain', key); summary.spreadsheet[key] = avg('spreadsheet', key);
      summary.spreadsheetMinusPlain[key] = round(summary.spreadsheet[key] - summary.plainHtml[key]);
    });
    summary.perTableExtra = {
      heapMB: round(summary.spreadsheetMinusPlain.heapGrowthMB / config.tables),
      domNodes: round(summary.spreadsheetMinusPlain.domNodesAdded / config.tables),
      contentReadMs: round(summary.spreadsheetMinusPlain.contentReadMs / config.tables),
    };
    self.report = { setup: config, baselinePage: baseline, ...summary, runs };
    self.progress = { done: true };
    return self.report;
  };

  // The plain-versus-spreadsheet comparison at growing numbers of tables. If the cost per table stays
  // about the same as the count grows, it scales; if it climbs, something does not.
  // Options: steps (default [10, 30, 60, 100]), rows, cols.
  self.scaling = async (options = {}) => {
    const steps = options.steps ?? [10, 30, 60, 100];
    const table = [];
    for (const count of steps) {
      self.progress = { scalingStep: count };
      const result = await self.compareWithPlainHtml({ tables: count, rounds: 1, rows: options.rows ?? 5, cols: options.cols ?? 4 });
      table.push({
        tables: count,
        plainContentReadMs: result.plainHtml.contentReadMs, sheetContentReadMs: result.spreadsheet.contentReadMs,
        extraContentReadMsPerTable: result.perTableExtra.contentReadMs,
        plainHeapMB: result.plainHtml.heapGrowthMB, sheetHeapMB: result.spreadsheet.heapGrowthMB, extraHeapMBPerTable: result.perTableExtra.heapMB,
        plainDomNodes: result.plainHtml.domNodesAdded, sheetDomNodes: result.spreadsheet.domNodesAdded,
        liveGrids: result.spreadsheet.liveGridsAfter,
        plainFrameP95Ms: result.plainHtml.frameP95Ms, sheetFrameP95Ms: result.spreadsheet.frameP95Ms,
      });
    }
    self.scalingReport = table;
    self.progress = { done: true };
    return table;
  };

  self.compare = async (options = {}) => {
    const config = { tables: 25, bigRows: 0, bigCols: 0, rounds: 3, ...options };
    const original = api().checksEnabled();
    window.confirm = () => true;
    const added = [];
    self.progress = { step: 'adding tables' };
    for (let i = 0; i < config.tables; i++) added.push(api().insertScratch(5, 4));
    const main = api().insertScratch(config.bigRows || 5, config.bigCols || 4);
    added.push(main);
    await sleep(2500);
    const results = { on: [], off: [] };
    let overheadMs = 0; let overheadCalls = 0;
    const memoryBefore = memory();
    try {
      for (let round = 1; round <= config.rounds; round++) {
        for (const mode of (round % 2 ? ['on', 'off'] : ['off', 'on'])) {
          self.progress = { round, mode };
          api().setChecks(mode === 'on');
          api().overhead(true);
          results[mode].push(await workload(main, !!config.bigRows));
          if (mode === 'on') { const used = api().overhead(true); overheadMs += used.ms; overheadCalls += used.calls; }
          await sleep(500);
        }
      }
    } finally {
      api().setChecks(original);
      added.forEach(uid => api().removeTable(uid));
      editor().execCommand('mceSave');
    }
    const memoryAfter = memory();
    const on = summarise(results.on); const off = summarise(results.off);
    const diff = {};
    Object.keys(on).forEach(key => { diff[key] = on[key] !== null && off[key] !== null ? round(on[key] - off[key]) : null; });
    self.report = {
      setup: { extraTables: config.tables, bigTable: config.bigRows ? `${config.bigRows}x${config.bigCols}` : 'none', rounds: config.rounds, liveOverlays: null },
      checksOn: on, checksOff: off, difference: diff,
      timeUsedByTheChecks: { ms: round(overheadMs), calls: overheadCalls, msPerCall: overheadCalls ? round(overheadMs / overheadCalls) : null },
      memory: { before: memoryBefore, after: memoryAfter },
    };
    self.progress = { done: true };
    return self.report;
  };

  return self;
})();
