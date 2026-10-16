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

  // set up: several spreadsheets with text between them
  editor.setContent('<p>Speed test.</p>' + Array.from({ length: tables }, (_, i) => tableHtml(i)).join(''));
  window.scrollTo(0, 0);
  await sleep(2500);

  // 1. scrolling: frame times while moving past all the tables
  const frames = [];
  let last = now();
  let running = true;
  const tick = () => { if (!running) return; const t = now(); frames.push(t - last); last = t; requestAnimationFrame(tick); };
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
      const box = await until(() => Array.from(document.querySelectorAll('.elabftw-spreadsheet-rescue-input, .jss_editor input, .jss_editor textarea')).find(e => e.offsetParent !== null && !e.hidden), 3000);
      if (!box.value) { failed++; continue; }
      open.push(now() - start);
      box.value.value = value;
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

  editor.setContent('<p>Speed test finished (nothing was saved).</p>');
  return result;
};
