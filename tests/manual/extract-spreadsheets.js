// Collects what is needed to look into a spreadsheet that misbehaves in the main text (page jumping, overlap, ...).
// Open the entry in edit mode, open the browser's developer console (Firefox: Cmd+Option+K), paste this whole file,
// press Enter. If Firefox asks, type  allow pasting  first. The result is copied to the clipboard (and printed);
// paste it into a message or a file.
//
// REDACT = true replaces every letter and digit in the cells with "x" (structure, styles, sizes are kept), so no data leaves
// the page. Set it to false only when the content may be shared.
(() => {
  const REDACT = true;
  const ed = window.tinymce && window.tinymce.activeEditor;
  if (!ed) { console.warn('No editor on this page: open the entry in edit mode first.'); return; }
  const body = ed.getBody();
  const win = ed.getWin();
  const iframe = ed.iframeElement;
  const redact = html => {
    if (!REDACT) return html;
    const box = document.createElement('div');
    box.innerHTML = html;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = node.nodeValue.replace(/[^\s]/g, 'x');
    return box.innerHTML;
  };
  const describe = el => el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''}` : null;
  const rect = el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }; };
  const tables = [...body.querySelectorAll('table.elabftw-spreadsheet')];
  const report = {
    page: location.pathname + location.search,
    when: new Date().toISOString(),
    browser: navigator.userAgent,
    redacted: REDACT,
    editor: {
      focused: ed.hasFocus(),
      iframe: rect(iframe),
      bodyScrollHeight: body.scrollHeight,
      pageScrollY: Math.round(window.scrollY),
      selectionIn: describe(ed.selection.getNode()),
    },
    overlays: document.querySelectorAll('.elabftw-spreadsheet-readonly-view, .elabftw-spreadsheet-editor-overlay').length,
    tables: tables.map((table, index) => {
      const chain = [];
      for (let el = table.parentElement; el && el !== body; el = el.parentElement) chain.push(describe(el));
      const spacer = [...body.querySelectorAll('[data-elabftw-spreadsheet-spacer]')].find(s => s.previousElementSibling === table || s.previousSibling === table);
      const cs = win.getComputedStyle(table);
      return {
        index,
        attributes: Object.fromEntries(table.getAttributeNames().filter(n => n !== 'style').map(n => [n, table.getAttribute(n)])),
        style: table.getAttribute('style'),
        rows: table.rows.length,
        columns: table.rows[0] ? table.rows[0].cells.length : 0,
        rect: rect(table),
        computed: { display: cs.display, position: cs.position, visibility: cs.visibility, width: cs.width, marginLeft: cs.marginLeft, tableLayout: cs.tableLayout },
        insideOf: chain,
        previous: describe(table.previousElementSibling),
        next: describe(table.nextElementSibling),
        spacerHeight: spacer ? spacer.style.height + ' / margin-top ' + spacer.style.marginTop : null,
        html: redact(table.outerHTML),
      };
    }),
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (typeof copy === 'function') { copy(text); console.log('Copied to the clipboard (' + text.length + ' characters).'); }
  return report;
})();
