/**
 * Printing spreadsheets and selected sections from a view page. On the view page of an entry that has headings and at least one spreadsheet:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/print-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await printCheck();      // returns {pass, results}
 *
 * print-matches-live: the print rules are in the stylesheet (colours kept, no clipping, no bars/toolbars), and the printed copy holds each
 * spreadsheet as a table with the grid's rows, columns and coordinate cells, scaled to the page when wider than it, with no editing parts.
 * print-selected-sections: with sections ticked in the Contents panel the printed copy holds only those (with the headings above them) and
 * says so; with none ticked it holds the whole text. window.print is replaced for the check, nothing is sent to a printer.
 */
window.printCheck = async function printCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) if (rule.type === CSSRule.MEDIA_RULE && /print/.test(rule.conditionText || rule.media.mediaText)) for (const inner of rule.cssRules) rules.push(inner.cssText);
  }
  const printCss = rules.join('\n');
  check('print rules keep the fills of a sheet (print-color-adjust exact)', /print-color-adjust:\s*exact/.test(printCss) && /elabftw-spreadsheet/.test(printCss), 'rule missing');
  check('print rules let a sheet show in full (overflow visible, no height cap)', /\.elabftw-spreadsheet-readonly-view[^{]*\{[^}]*overflow:\s*visible/.test(printCss), 'rule missing');
  check('print rules hide the bars and toolbars of a sheet', /elabftw-own-scrollbar[^{]*\{[^}]*display:\s*none/.test(printCss) || /elabftw-own-scrollbar[\s\S]*display:\s*none/.test(printCss), 'rule missing');
  check('print rules hide the sticky entry toolbar (it would print over the text once scrolled)', /(#entityToolbar|sticky-toolbar)[^{]*\{[^}]*display:\s*none/.test(printCss), 'rule missing');
  check('print rules never split a row and repeat the header', /break-inside:\s*avoid/.test(printCss) && /table-header-group/.test(printCss), 'rules missing');

  const body = document.getElementById('body_view');
  const sheets = body ? body.querySelectorAll('.elabftw-spreadsheet-readonly-view') : [];
  check('this page has a spreadsheet to print', sheets.length > 0, 'no .elabftw-spreadsheet-readonly-view in #body_view');
  const headingCount = body ? body.querySelectorAll('h1,h2,h3,h4,h5,h6').length : 0;
  const printed = [];
  const realPrint = window.print;
  window.print = () => { const d = document.getElementById('tocPrintSelectionDocument'); printed.push(d ? d.cloneNode(true) : null); };
  const click = el => el && el.click();
  const rowsOf = () => [...document.querySelectorAll('#tocItems .toc-item-section')];
  try {
    const panel = document.getElementById('tocPanel');
    if (panel && panel.hidden) { click(document.getElementById('tocPanelOpener')); await sleep(700); }
    const toggle = document.getElementById('tocSelectToggle');
    check('the Contents panel has Select mode', !!toggle, 'no #tocSelectToggle');
    if (toggle) {
      if (toggle.getAttribute('aria-pressed') !== 'true') { click(toggle); await sleep(300); }
      // nothing ticked: the whole text is printed
      const selectNone = document.getElementById('tocSelectNone'); click(selectNone); await sleep(300);
      // tick the second section only
      const rows = rowsOf();
      check('the panel lists sections', rows.length >= 2, `${rows.length} section rows (${headingCount} headings)`);
      if (rows.length >= 2) {
        const label = rows[1].querySelector('.toc-link')?.textContent?.trim();
        click(rows[1].querySelector('[data-toc-section-checkbox]')); await sleep(500);
        const position = document.body.dataset.tocSections;
        check('ticking a section publishes its heading position for the PDF export', !!position, 'no data-toc-sections on body');
        click(document.getElementById('tocPrintAll')); await sleep(500);
        const doc = printed.pop();
        check('print-selected-sections: a copy is printed', !!doc, 'window.print ran with no #tocPrintSelectionDocument');
        if (doc) {
          const text = doc.textContent || '';
          check('print-selected-sections: the ticked section is in the printed copy', label && text.includes(label), `"${label}" missing`);
          const other = rows.map(r => r.querySelector('.toc-link')?.textContent?.trim()).find(t => t && t !== label && !(label && label.includes(t)) && !text.includes(t));
          check('print-selected-sections: a section that was not ticked is not printed', rows.length === 1 || !!other, 'every heading was printed');
          check('print-selected-sections: the copy says it holds selected sections only', /selected/i.test(doc.querySelector('.toc-print-context')?.textContent || ''), doc.querySelector('.toc-print-context')?.textContent);
        }
        // everything again
        click(document.getElementById('tocSelectAll')); await sleep(300); click(document.getElementById('tocSelectNone')); await sleep(400);
      }
    }
    // print-whole-entry / pdf-whole-entry: the buttons in the panel header are always there; with nothing ticked they take the whole entry
    const headerPrint = document.getElementById('tocPrintAll');
    const headerPdf = document.getElementById('tocPdfAll');
    check('print-whole-entry: Print is in the Contents panel header with nothing ticked', !!headerPrint && getComputedStyle(headerPrint).display !== 'none', 'no #tocPrintAll');
    check('pdf-whole-entry: PDF is in the Contents panel header with nothing ticked', !!headerPdf && getComputedStyle(headerPdf).display !== 'none', 'no #tocPdfAll');
    check('print-whole-entry: the tooltip says whole entry', /whole entry/i.test(headerPrint?.title || ''), headerPrint?.title);
    if (headerPrint) {
      headerPrint.click(); await sleep(600);
      const entirePrint = printed.pop();
      const entireText = entirePrint ? entirePrint.textContent || '' : '';
      const headingTexts = [...(body ? body.querySelectorAll('h1,h2,h3,h4,h5,h6') : [])].map(h => h.textContent.trim()).filter(Boolean);
      check('print-whole-entry: nothing ticked prints every heading of the entry', !!entirePrint && headingTexts.every(t => entireText.includes(t)), `missing: ${headingTexts.filter(t => !entireText.includes(t)).join(', ')}`);
    }
    const entryMenuPrint = document.querySelector("[data-action='print-entry']");
    check('the Export menu of the entry has Print', !!entryMenuPrint, 'no print-entry item');
    const exporter = document.querySelector("[data-action='export-to'][data-format='pdf']");
    if (exporter) {
      const url = `/api/v2/${exporter.dataset.type}/${exporter.dataset.id}?format=pdf`;
      const whole = await fetch(url, { credentials: 'same-origin' });
      const wholeSize = (await whole.arrayBuffer()).byteLength;
      check('pdf-whole-entry: no sections gives a PDF of the whole entry', whole.status === 200 && /pdf/.test(whole.headers.get('content-type') || '') && wholeSize > 5000, `status ${whole.status}, ${wholeSize} bytes`);
      const part = await fetch(url + '&sections=1', { credentials: 'same-origin' });
      const partSize = (await part.arrayBuffer()).byteLength;
      check('pdf-selected-sections: sections=1 gives a PDF (a different one)', part.status === 200 && /pdf/.test(part.headers.get('content-type') || '') && partSize > 2000 && partSize !== wholeSize, `status ${part.status}, ${partSize} vs ${wholeSize} bytes`);
    }
    // the whole text, spreadsheets included
    const trigger = document.getElementById('tocPrintAll');
    if (trigger) { trigger.disabled = false; click(trigger); await sleep(500); }
    const whole = printed.pop();
    if (whole) {
      check('print-matches-live: no editing parts in the printed copy', !whole.querySelector('.elabftw-spreadsheet-readonly-toggle, .jss_toolbar, .elabftw-own-scrollbar, .elabftw-view-xbar, button, input'), 'toolbar/bar/button found');
      const tables = [...whole.querySelectorAll('table.elabftw-spreadsheet')];
      check('print-matches-live: each sheet is printed as a grid table', tables.length >= sheets.length - whole.querySelectorAll('.elabftw-well-plate-view').length, `${tables.length} tables for ${sheets.length} sheets`);
      // the hosts are looked up again here: the page may have redrawn them since the first look. Tables beyond the live sheets are plain
      // saved tables of the entry (no live grid behind them): they are printed as they are, so only live sheets get the scaling check.
      const liveHosts = body ? body.querySelectorAll('.elabftw-spreadsheet-readonly-view') : [];
      tables.forEach((table, i) => {
        const original = liveHosts[i];
        const liveCols = original ? original.querySelectorAll('.jss_worksheet > thead > tr > td[data-x]').length : null;
        const liveRows = original ? original.querySelectorAll('.jss_worksheet > tbody > tr').length : null;
        const printCols = table.querySelectorAll('thead th').length - 1;
        const printRows = table.querySelectorAll('tbody tr').length;
        if (liveCols !== null) check(`print-matches-live: sheet ${i + 1} has the live columns and rows`, liveCols === printCols && liveRows === printRows, `live ${liveCols}x${liveRows}, printed ${printCols}x${printRows}`);
        check(`print-matches-live: sheet ${i + 1} has its coordinate cells`, table.querySelectorAll('.spreadsheet-coordinate').length === printCols + printRows + 1, 'coordinate cells missing');
        const width = parseFloat(table.style.width) || 0;
        const zoom = parseFloat(table.style.zoom) || 1;
        if (original) check(`print-matches-live: sheet ${i + 1} fits the page (scaled when wider than 700 px)`, width * zoom <= 701, `${width} px at zoom ${zoom}`);
      });
    } else check('print-matches-live: the whole text can be printed', false, 'window.print never ran');
  } finally {
    window.print = realPrint;
    document.body.classList.remove('toc-print-selection-active');
    document.getElementById('tocPrintSelectionDocument')?.remove();
  }
  return { pass: results.every(r => r.ok), results };
};
