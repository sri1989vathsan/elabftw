/*
 * Films what happens to every spreadsheet on a page, frame by frame, when rows are added to the first one.
 * Use it in the browser console (Firefox included) on an experiment edit page that has two or more spreadsheets:
 *
 *   1. scroll so the first spreadsheet is visible, and click one of its cells (the Add rows bar appears)
 *   2. paste this whole file into the console, press Enter
 *   3. it adds 5 rows, then prints a table: one line each time anything moved
 *
 * "off0", "off1" ... are how far each grid sits from its real table in the editor (0 = exactly on it).
 * A value other than 0 for a frame or two is the jitter; the line shows which grid and for how long.
 */
(async () => {
  const ed = tinymce.activeEditor;
  const ifr = document.getElementById(`${ed.id}_ifr`);
  const doc = ed.getDoc();
  const tables = [...doc.querySelectorAll('table.elabftw-spreadsheet')];
  const overlays = () => [...document.querySelectorAll('.elabftw-spreadsheet-editor-overlay')];
  const bar = document.querySelector('.elabftw-spreadsheet-editor-overlay.is-active-table .elabftw-spreadsheet-add-rows');
  if (!bar) { console.warn('Click a cell of the first spreadsheet first, so the Add rows bar shows.'); return; }
  bar.querySelector('input').value = '5';
  const frames = [];
  const start = performance.now();
  let running = true;
  const tick = () => {
    if (!running) return;
    const frame = ifr.getBoundingClientRect();
    const row = { ms: Math.round(performance.now() - start), editor: Math.round(frame.height), scrollY: Math.round(window.scrollY) };
    overlays().forEach((overlay, index) => {
      const table = tables[index];
      if (!table) return;
      row[`off${index}`] = Math.round((overlay.getBoundingClientRect().top - (frame.top + table.getBoundingClientRect().top)) * 10) / 10;
      row[`h${index}`] = Math.round(overlay.getBoundingClientRect().height);
    });
    frames.push(row);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await new Promise(resolve => setTimeout(resolve, 200));
  bar.querySelector('button').click();
  await new Promise(resolve => setTimeout(resolve, 2500));
  running = false;
  const changes = [];
  let previous = '';
  for (const row of frames) {
    const key = JSON.stringify({ ...row, ms: 0 });
    if (key !== previous) { changes.push(row); previous = key; }
  }
  console.log(`${frames.length} frames filmed; ${changes.length} lines where something changed`);
  console.table(changes);
})();
