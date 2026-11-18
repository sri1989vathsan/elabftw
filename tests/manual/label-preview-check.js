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
