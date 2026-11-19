/**
 * "Print label" in the Tools menu (head.html #navPrintLabelItem, web/label-dialog.js). Logged in; run it on the dashboard and again on the view or edit
 * page of an entry (an experiment or a resource), in the browser console or through Chrome DevTools / Marionette:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/label-tools-menu-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await labelToolsMenuCheck();      // {pass, results}
 * Nothing is printed and nothing is saved: the preview is a dry run, and Print is only pressed to read the answer when no printer is set or reachable
 * (if a real printer answers, the script presses nothing and says so).
 *   1. the Tools menu has "Print label", the + menu no longer has "Print a label";
 *   2. a click opens the dialog with a preview of the label and the label formats loaded;
 *   3. on an entry page the title of the entry is in the text of the label; elsewhere the text is empty (type or paste what you want, as before);
 *   4. Print with an unreachable or unset printer answers with a clear message in red;
 *   5. the item is also in the More menu when the window is narrow (a copy that works the same: checked when the More menu is there).
 */
window.labelToolsMenuCheck = async function labelToolsMenuCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const dialog = () => document.querySelector('.planned-dialog');
  const close = () => document.querySelector('.planned-backdrop')?.remove();
  close();

  const toggle = document.getElementById('navToolsDropdown');
  check('the Tools menu is in the navbar', toggle, 'no #navToolsDropdown');
  const item = document.getElementById('navPrintLabelItem');
  check('the Tools menu has "Print label"', item && /Print label/.test(item.textContent) && toggle?.parentElement.contains(item), 'no item');
  check('the + menu has no "Print a label" any more', !document.querySelector('#navbar-create-dropdown [data-action="print-generic-label"]') && !/Print a label/.test(document.getElementById('navbar-create-dropdown')?.textContent ?? ''), 'still in the + menu');
  if (!item) return { pass: false, results };

  const title = document.getElementById('documentTitle')?.textContent.trim() ?? '';
  item.click();
  check('a click opens the dialog', await waitFor(dialog), 'no .planned-dialog');
  const box = dialog();
  if (!box) return { pass: false, results };
  const select = box.querySelector('select');
  check('the label formats are loaded', await waitFor(() => select && select.options.length > 0), 'no format in the list');
  check('the preview of the label is drawn', await waitFor(() => box.querySelector('svg')) && !/Preview unavailable/.test(box.innerText), box.innerText.slice(0, 120));
  const text = box.querySelector('textarea');
  if (title) check('on an entry page the title of the entry is in the text', text.value === title.slice(0, 200), `text: ${text.value}`);
  else check('elsewhere the text is empty (nothing to pick: type the text)', text.value === '', `text: ${text.value}`);

  // the printer
  const status = await (await fetch('label-print.php', { credentials: 'same-origin' })).json();
  if (status.printer_set) {
    check('(a printer is set: Print is not pressed so that no label comes out)', true);
  } else {
    if (text.value.trim() === '') { text.value = 'label check'; text.dispatchEvent(new Event('input', { bubbles: true })); }
    const print = [...box.querySelectorAll('button')].find(b => b.textContent === 'Print');
    print.click();
    const message = await waitFor(() => { const m = box.querySelector('.text-danger'); return m && m.textContent.length > 0 ? m : null; });
    check('Print without a reachable printer says so in red', message && /printer/i.test(message.textContent), message?.textContent ?? 'no message');
  }
  close();

  // the copy in the More menu
  const more = document.getElementById('navbarMoreItem');
  if (more && more.style.display !== 'none') {
    const copy = more.querySelector('[data-print-label-open]');
    check('the More menu has its own "Print label"', copy, 'no copy');
    copy?.click();
    check('and it opens the dialog', await waitFor(dialog), 'no dialog');
    close();
  }
  const pass = results.every(r => r.ok);
  console.table(results);
  return { pass, results };
};
