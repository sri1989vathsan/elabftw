/**
 * "Print a label" dialog (the + menu): the preview must show. Load in the console on any page and call `await labelPreviewCheck()`.
 * No label is printed: the dialog only asks for a dry run (the drawing).
 */
window.labelPreviewCheck = async function labelPreviewCheck() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, ok: !!pass, detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(150); } return fn(); };
  document.querySelector('.planned-backdrop')?.remove();
  const item = document.querySelector('[data-action="print-generic-label"]');
  ok('the + menu has "Print a label"', !!item, '');
  if (!item) return { pass: false, results };
  item.click();
  const svg = await waitFor(() => document.querySelector('.planned-dialog svg'));
  ok('the preview is there when the dialog opens (no text yet)', !!svg, document.querySelector('.planned-dialog')?.innerText.slice(0, 120));
  if (svg) { const b = svg.getBoundingClientRect(); ok('the preview is more than 100px wide', b.width > 100 && b.height > 30, `${Math.round(b.width)}x${Math.round(b.height)}`); }
  const unavailable = /Preview unavailable/.test(document.querySelector('.planned-dialog')?.innerText || '');
  ok('no "Preview unavailable" message', !unavailable, '');
  const text = document.querySelector('.planned-dialog textarea');
  text.value = 'Check {name}'; text.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1200);
  ok('after typing the preview is still drawn', !!document.querySelector('.planned-dialog svg'), '');
  document.querySelector('.planned-backdrop')?.remove();
  return { pass: results.every(r => r.ok), results };
};

/**
 * The Labels tab of the Admin panel (admin only): open http://localhost:8973/admin.php?tab=10 as an admin and call `await labelsTabCheck()`.
 * No label is printed and nothing is saved. Checks the layout: no sideways scroll, controls inside the content box, small muted
 * subsection headings, a format list whose cells do not run into each other, and compact icon buttons.
 */
window.labelsTabCheck = async function labelsTabCheck() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, ok: !!pass, detail: pass ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !document.querySelector('.lf-app .lf-format'); i++) await sleep(200);
  const app = document.querySelector('.lf-app');
  ok('the Labels tab is there', !!app, 'no .lf-app');
  if (!app) return { pass: false, results };
  const de = document.documentElement;
  ok('the page has no sideways scroll', de.scrollWidth <= window.innerWidth + 1, `scrollWidth ${de.scrollWidth} > window width ${window.innerWidth}`);
  const box = app.getBoundingClientRect();
  ok('the content is at most 42rem wide', box.width <= 42 * parseFloat(getComputedStyle(de).fontSize) + 1, `${Math.round(box.width)} px`);
  const outside = [...app.querySelectorAll('input, select, textarea, button')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
  });
  ok('every control is inside the content box', outside.length === 0, outside.map(el => el.id || el.className).join(', '));
  const headings = [...app.querySelectorAll('.lf-h')];
  ok('the subsection headings are small (under 0.85 rem) and muted uppercase', headings.length >= 2 && headings.every(h => parseFloat(getComputedStyle(h).fontSize) < 0.85 * parseFloat(getComputedStyle(de).fontSize) && getComputedStyle(h).textTransform === 'uppercase'), headings.map(h => getComputedStyle(h).fontSize).join(', '));
  const rows = [...app.querySelectorAll('.lf-format')];
  ok('there is at least one format row', rows.length > 0, '');
  rows.forEach(row => {
    const cells = [...row.children].filter(c => c.textContent.trim() !== '' || c.querySelector('button'));
    const rects = cells.map(c => c.getBoundingClientRect());
    const overlap = rects.some((a, i) => rects.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    ok(`the cells of "${row.firstChild.textContent}" do not run into each other`, !overlap, '');
    ok(`the row of "${row.firstChild.textContent}" is compact (about 1.9rem)`, row.getBoundingClientRect().height <= 2.4 * parseFloat(getComputedStyle(de).fontSize), `${Math.round(row.getBoundingClientRect().height)} px`);
  });
  const iconButtons = [...app.querySelectorAll('.lf-icon-btn')];
  ok('the edit and delete buttons have no border', iconButtons.every(b => parseFloat(getComputedStyle(b).borderTopWidth) === 0), '');
  const rowsGrid = [...app.querySelectorAll('.lf-row')];
  const labelWidths = new Set(rowsGrid.map(r => Math.round(r.firstChild.getBoundingClientRect().width)));
  ok('the labels share one column width', labelWidths.size <= 1, [...labelWidths].join(', '));
  const gaps = rowsGrid.slice(0, -1).map((r, i) => rowsGrid[i + 1].getBoundingClientRect().top - r.getBoundingClientRect().bottom);
  ok('there is room (at least 6 px) between one row and the next, help text included', gaps.every(g => g >= 6), gaps.join(', '));
  return { pass: results.every(r => r.ok), results };
};
