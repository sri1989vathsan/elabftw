/*
 * Speed of the inline spreadsheet, measured with plain mouse and keyboard events only, so the very same
 * script runs on the current editor code and on an older one (no test hooks needed).
 *
 * Use it on an experiment edit page (not one you care about: it replaces the text, nothing is saved), with the
 * browser window fully visible:
 *
 *     await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/__tests/perf-compare.js?' + Date.now(); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
 *     const result = await perfCompare({ label: 'current' });
 *     console.log(JSON.stringify(result));
 *
 * What it measures (milliseconds):
 *   - scrolling: frame time while scrolling past 8 spreadsheets (median, 95th percentile, worst, frames over 33 ms)
 *   - activate: from pressing on a preview to the live grid having cells
 *   - edit-open: from a double-click to the cell editor being there, and edit-commit: from Enter to the value shown
 *     (40 edits; the first 10 against the last 10 shows whether it slows down while you work)
 *   - popup-open / popup-close: opening and closing the full editor window
 *   - mount: from putting the tables in the text until the first grid shows
 *   - jiggle (while scrolling): frames where a grid sits more than 1.5 px away from the table it stands for, the
 *     worst such offset, and how often (and by how much) the page height changes under you
 *   - memory: JavaScript heap (Chrome-based browsers only) and number of page elements, at the start, after the
 *     scroll and at the end
 */
window.perfCompare = async function perfCompare({ label = 'run', tables = 8, rows = 10, cols = 6, edits = 40, popups = 5 } = {}) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const now = () => performance.now();
  const median = values => { const s = values.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const pct = (values, p) => { const s = values.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
  const round = v => (v === null || v === undefined ? v : Math.round(v * 10) / 10);
  const until = async (predicate, timeout = 8000) => {
    const start = now();
    while (now() - start < timeout) { const value = predicate(); if (value) return { value, ms: now() - start }; await sleep(8); }
    return { value: null, ms: now() - start };
  };
  if (document.hidden) throw new Error('The page is hidden: bring the window to the front and run it again.');

  const editor = tinymce.activeEditor;
  const doc = editor.getDoc();
  const iframe = document.getElementById(`${editor.id}_ifr`);
  const encode = value => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  const colLabel = i => String.fromCharCode(65 + (i % 26));
  const tableHtml = (index) => {
    const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ((r + c + index) % 3 === 0 ? `v${r}${c}` : '')));
    const head = `<tr><th class="spreadsheet-coordinate"></th>${Array.from({ length: cols }, (_, c) => `<th class="spreadsheet-coordinate">${colLabel(c)}</th>`).join('')}</tr>`;
    const body = data.map((row, r) => `<tr><th class="spreadsheet-coordinate">${r + 1}</th>${row.map(v => `<td>${v}</td>`).join('')}</tr>`).join('');
    return `<table class="elabftw-spreadsheet" data-spreadsheet="${encode({ data, rows, cols, kind: 'standard' })}"><thead>${head}</thead><tbody>${body}</tbody></table><p>Text after table ${index + 1}.</p>`;
  };
  const overlays = () => Array.from(document.querySelectorAll('.elabftw-spreadsheet-editor-overlay'));
  const isPreview = o => o.classList.contains('elabftw-spreadsheet-preview');
  const press = (el, extra = {}) => {
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, buttons: 1, ...extra };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  };
  const top = () => iframe.getBoundingClientRect().top + window.scrollY;
  const result = { label, userAgent: navigator.userAgent.slice(-40), tables, rows, cols };
  const heapMb = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null);
  const elementCount = () => document.getElementsByTagName('*').length + doc.getElementsByTagName('*').length;
  const memory = {};

  // set up: several spreadsheets with text between them
  const html = '<p>Speed test.</p>' + Array.from({ length: tables }, (_, i) => tableHtml(i)).join('');
  editor.setContent('<p>Warm-up.</p>');
  await sleep(800);
  window.scrollTo(0, top() - 150);
  await sleep(300);
  const mountStart = now();
  editor.setContent(html);
  const firstGrid = await until(() => overlays().length > 0 && overlays()[0].querySelector('.jss_worksheet td[data-x]'), 10000);
  result.mount = { firstGridMs: firstGrid.value ? round(now() - mountStart) : null };
  window.scrollTo(0, 0);
  await sleep(2500);
  memory.start = { heapMb: heapMb(), elements: elementCount() };

  // 1. scrolling: frame times while moving past all the tables
  const frames = [];
  const jiggle = { frames: 0, offsetFrames: 0, worstOffsetPx: 0, heightChanges: 0, totalHeightShiftPx: 0 };
  let prevPage = document.documentElement.scrollHeight;
  let prevFrame = iframe.getBoundingClientRect().height;
  const tableTops = () => { const top0 = iframe.getBoundingClientRect().top; return Array.from(doc.querySelectorAll('table.elabftw-spreadsheet')).map(t => top0 + t.getBoundingClientRect().top); };
  const sampleJiggle = () => {
    const page = document.documentElement.scrollHeight;
    const frame = iframe.getBoundingClientRect().height;
    if (Math.abs(page - prevPage) > 0.5 || Math.abs(frame - prevFrame) > 0.5) { jiggle.heightChanges++; jiggle.totalHeightShiftPx += Math.abs(page - prevPage); }
    prevPage = page; prevFrame = frame;
    const tops = tableTops();
    overlays().forEach(o => {
      const ot = o.getBoundingClientRect().top;
      if (ot < -2000 || ot > innerHeight + 2000) return;
      const best = Math.min(...tops.map(t => Math.abs(ot - t)));
      if (!Number.isFinite(best)) return;
      jiggle.frames++;
      if (best > 1.5) jiggle.offsetFrames++;
      jiggle.worstOffsetPx = Math.max(jiggle.worstOffsetPx, Math.round(best));
    });
  };
  let last = now();
  let running = true;
  const tick = () => { if (!running) return; const t = now(); frames.push(t - last); last = t; sampleJiggle(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.scrollTo(0, top() - 150);
  await sleep(800);
  const stepPx = 120;
  const total = iframe.getBoundingClientRect().height;
  for (let y = 0; y < total; y += stepPx) { window.scrollBy(0, stepPx); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
  await sleep(500);
  running = false;
  const used = frames.slice(5);
  result.scrolling = { frames: used.length, medianMs: round(median(used)), p95Ms: round(pct(used, 0.95)), worstMs: round(Math.max(...used)), over33ms: used.filter(v => v > 33.5).length };
  result.jiggle = jiggle;
  memory.afterScroll = { heapMb: heapMb(), elements: elementCount() };

  // 2. activate: press on a preview until the live grid has cells
  window.scrollTo(0, top() - 150);
  await sleep(1500);
  const activate = [];
  for (let i = 0; i < Math.min(4, tables); i++) {
    const preview = overlays().filter(isPreview)[0];
    if (!preview) break;
    const cell = preview.querySelector('td[data-x][data-y]');
    if (!cell) break;
    const start = now();
    press(cell);
    const ready = await until(() => overlays().find(o => !isPreview(o) && o.querySelector('.jss_worksheet td[data-x]') && o.contains(document.querySelector('.jss_worksheet'))), 6000);
    if (ready.value) activate.push(now() - start);
    await sleep(400);
    window.scrollBy(0, 200);
    await sleep(700);
  }
  result.activate = { runs: activate.length, medianMs: round(median(activate)), allMs: activate.map(round) };

  // 3. editing in a live grid: time to the cell editor, time to the committed value
  window.scrollTo(0, top() - 150);
  await sleep(1500);
  let live = overlays().find(o => !isPreview(o));
  if (!live) {
    const preview = overlays()[0];
    press(preview.querySelector('td[data-x][data-y]'));
    await until(() => overlays().find(o => !isPreview(o)), 6000);
    live = overlays().find(o => !isPreview(o));
  }
  const open = [];
  const commit = [];
  let failed = 0;
  if (live) {
    for (let i = 0; i < edits; i++) {
      const r = i % rows; const c = (i * 2) % cols;
      const td = live.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
      if (!td) { failed++; continue; }
      const value = `E${i}`;
      const rect = td.getBoundingClientRect();
      const start = now();
      td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
      // the editor is an input in the cell itself, or the page's own rescue input, or the library's editor box
      const findBox = () => td.querySelector('input, textarea, [contenteditable="true"]')
        || Array.from(document.querySelectorAll('.elabftw-spreadsheet-rescue-input')).find(e => !e.hidden && e.offsetParent !== null)
        || document.querySelector('.jss_editor input, .jss_editor textarea, td.editor input, td.editor textarea');
      const box = await until(findBox, 3000);
      if (!box.value) { failed++; continue; }
      open.push(now() - start);
      if (box.value.isContentEditable && !('value' in box.value)) box.value.textContent = value; else box.value.value = value;
      box.value.dispatchEvent(new Event('input', { bubbles: true }));
      const commitStart = now();
      box.value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      const shown = await until(() => (live.querySelector(`td[data-x="${c}"][data-y="${r}"]`)?.textContent ?? '').trim() === value, 3000);
      if (shown.value) commit.push(now() - commitStart); else failed++;
      await sleep(60);
    }
  }
  const part = (values, from, to) => round(median(values.slice(from, to)));
  result.editOpen = { runs: open.length, failed, medianMs: round(median(open)), first10Ms: part(open, 0, 10), last10Ms: part(open, -10) };
  result.editCommit = { runs: commit.length, medianMs: round(median(commit)), first10Ms: part(commit, 0, 10), last10Ms: part(commit, -10) };

  // 4. the full editor window
  const popupOpen = [];
  const popupClose = [];
  for (let i = 0; i < popups && live; i++) {
    const button = live.querySelector('.elabftw-spreadsheet-readonly-open-editor');
    if (!button) break;
    const start = now();
    button.click();
    const dialog = await until(() => { const d = document.querySelector('.inline-spreadsheet-dialog'); return d && d.querySelector('.jss_worksheet td[data-x]') ? d : null; }, 8000);
    if (!dialog.value) break;
    popupOpen.push(now() - start);
    await sleep(500);
    const cancel = Array.from(dialog.value.querySelectorAll('button')).find(b => /^Cancel/.test(b.textContent.trim()));
    const closeStart = now();
    cancel?.click();
    const gone = await until(() => !document.querySelector('.inline-spreadsheet-dialog'), 8000);
    if (gone.value) popupClose.push(now() - closeStart);
    await sleep(500);
  }
  result.popupOpen = { runs: popupOpen.length, medianMs: round(median(popupOpen)), allMs: popupOpen.map(round) };
  result.popupClose = { runs: popupClose.length, medianMs: round(median(popupClose)) };

  await sleep(500);
  memory.end = { heapMb: heapMb(), elements: elementCount() };
  result.memory = memory;
  editor.setContent('<p>Speed test finished (nothing was saved).</p>');
  return result;
};
