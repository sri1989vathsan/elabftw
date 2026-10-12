/**
 * Acceptance checks for the inline spreadsheet grid and its popup (checklist section 6, A1-A9).
 *
 * Run from the browser console on an experiment's EDIT page (logged in), after pasting this file:
 *
 *     await spreadsheetAcceptance.setup();          // adds a scratch table at the end of the text
 *     await spreadsheetAcceptance.run('A5');        // one check
 *     await spreadsheetAcceptance.runAll();         // every check (can take a minute or two)
 *     await spreadsheetAcceptance.teardown();       // removes the scratch table again
 *
 * Every check returns { id, pass, details }. A check only ever touches the scratch table.
 * (A10, scrolling without jiggle, is measured separately: see CHECKLIST.md.)
 */
window.spreadsheetAcceptance = (() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const state = {};
  const api = () => window.elabftwSpreadsheetDiagnostics;
  const editor = () => tinymce.activeEditor;
  const tableEl = () => editor().getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${state.uid}"]`);
  const snap = () => api().snapshot(true).find(entry => entry.uid === state.uid);
  const inlineRoot = () => api().overlayElement(state.uid);
  const dialog = () => document.querySelector('.inline-spreadsheet-dialog');
  const cell = (root, r, c) => root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
  const text = (root, r, c) => (cell(root, r, c)?.innerText ?? '').trim();
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);
  const rowCount = root => root.querySelectorAll('.jss_worksheet tbody tr').length;
  const colCount = root => root.querySelectorAll('.jss_worksheet thead td[data-x], .jss_worksheet thead th[data-x]').length
    || root.querySelectorAll('.jss_worksheet tbody tr:first-child td[data-x]').length;

  async function show() {
    tableEl().scrollIntoView({ block: 'center' });
    await sleep(350);
    api().mountLive(state.uid);
    await sleep(600);
  }

  async function edit(root, r, c, value) {
    const td = cell(root, r, c);
    if (!td) throw new Error(`no cell ${r},${c}`);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box) throw new Error(`no editor opened for ${r},${c}`);
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(80);
  }

  async function select(root, r, c) {
    const td = cell(root, r, c);
    const rect = td.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1 };
    td.dispatchEvent(new PointerEvent('pointerdown', init));
    td.dispatchEvent(new MouseEvent('mousedown', init));
    td.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    td.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
    await sleep(150);
  }

  async function contextMenu(root, target, itemPattern) {
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 2 }));
    await sleep(250);
    const menu = [...document.querySelectorAll('.jcontextmenu')].find(m => getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().width > 0);
    const item = menu && [...menu.querySelectorAll('a')].find(a => itemPattern.test(a.textContent));
    if (!item) throw new Error(`context menu item ${itemPattern} not found`);
    item.click();
    await sleep(500);
  }

  async function openPopup() {
    await show();
    inlineRoot().querySelector('.elabftw-spreadsheet-readonly-open-editor').click();
    for (let i = 0; i < 60 && !dialog(); i++) await sleep(50);
    if (!dialog()) throw new Error('popup did not open');
    await sleep(500);
    return dialog();
  }
  async function closePopup(how) {
    const label = how === 'update' ? /^Update/ : /^Cancel/;
    const button = [...dialog().querySelectorAll('button')].find(b => label.test(b.textContent.trim()));
    button.click();
    for (let i = 0; i < 60 && dialog(); i++) await sleep(50);
    await sleep(900);
  }

  // The blocks around the table: how many layout spacers and what sits right after it.
  const surroundings = () => {
    const table = tableEl();
    const body = editor().getBody();
    const after = [];
    for (let node = table.nextElementSibling, i = 0; node && i < 4; node = node.nextElementSibling, i++) {
      after.push(`${node.tagName}${node.hasAttribute('data-elabftw-spreadsheet-spacer') ? '(spacer)' : ''}${node.textContent.trim() === '' ? '(empty)' : ''}`);
    }
    return {
      spacers: body.querySelectorAll('[data-elabftw-spreadsheet-spacer]').length,
      tables: body.querySelectorAll('table.elabftw-spreadsheet').length,
      afterTable: after.join(','),
      beforeTable: table.previousElementSibling ? table.previousElementSibling.tagName : '',
    };
  };

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const result = (id, pass, details) => ({ id, pass, details });

  const style = el => {
    const s = getComputedStyle(el);
    return {
      color: s.color, background: s.backgroundColor, font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`,
      align: s.textAlign, padding: s.padding, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
    };
  };

  const checks = {
    // A1: inline and popup show the same data.
    async A1() {
      await show();
      await edit(inlineRoot(), 0, 0, '11'); await edit(inlineRoot(), 1, 2, 'abc'); await edit(inlineRoot(), 2, 1, '=A1+1');
      await sleep(900);
      const rows = rowCount(inlineRoot()); const cols = colCount(inlineRoot());
      const inline = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) inline.push(text(inlineRoot(), r, c));
      const dlg = await openPopup();
      const popup = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) popup.push(text(dlg, r, c));
      await closePopup('cancel');
      const diffs = inline.map((v, i) => (v === popup[i] ? null : { index: i, inline: v, popup: popup[i] })).filter(Boolean);
      return result('A1', diffs.length === 0, { cells: inline.length, differences: diffs.slice(0, 6) });
    },

    // A2: inline Enter updates the table; the popup only on Update.
    async A2() {
      await show();
      await edit(inlineRoot(), 3, 0, 'inline-enter');
      await sleep(900);
      const inlineReached = JSON.stringify(snap().tableData).includes('inline-enter');
      const dlg = await openPopup();
      await edit(dlg, 3, 1, 'popup-enter');
      await sleep(900);
      const beforeUpdate = JSON.stringify(snap().tableData).includes('popup-enter');
      await closePopup('update');
      const afterUpdate = JSON.stringify(snap().tableData).includes('popup-enter');
      return result('A2', inlineReached && !beforeUpdate && afterUpdate, { inlineReachedTable: inlineReached, popupReachedTableBeforeUpdate: beforeUpdate, popupReachedTableAfterUpdate: afterUpdate });
    },

    // A3: the table is kept whether the changes are kept or not.
    async A3() {
      const outcomes = {};
      for (const how of ['update', 'cancel', 'escape']) {
        const dlg = await openPopup();
        await edit(dlg, 0, 3, `keep-${how}`);
        if (how === 'escape') {
          dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          await sleep(300);
          if (dialog()) await closePopup('cancel');
        } else {
          await closePopup(how);
        }
        await sleep(600);
        outcomes[how] = { tableExists: !!tableEl(), gridLive: !!api().overlayElement(state.uid), hasEdit: JSON.stringify(snap()?.tableData ?? []).includes(`keep-${how}`) };
      }
      const pass = Object.values(outcomes).every(o => o.tableExists && o.gridLive)
        && outcomes.update.hasEdit && !outcomes.cancel.hasEdit;
      return result('A3', pass, outcomes);
    },

    // A4: the spacing around the table does not change.
    async A4() {
      await show();
      const before = surroundings();
      await edit(inlineRoot(), 0, 1, '1'); await sleep(900);
      const afterInline = surroundings();
      const dlg = await openPopup(); await edit(dlg, 1, 1, '2'); await closePopup('update');
      const afterApply = surroundings();
      const dlg2 = await openPopup(); await edit(dlg2, 2, 2, '3'); await closePopup('cancel');
      const afterCancel = surroundings();
      for (let i = 0; i < 4; i++) { editor().getContent(); await sleep(200); }
      const afterSaves = surroundings();
      const all = { before, afterInline, afterApply, afterCancel, afterSaves };
      // Only tables near the screen have a spacer, so the spacer count is compared before and after, not with the table count.
      const pass = [afterInline, afterApply, afterCancel, afterSaves].every(s => same(s, before));
      return result('A4', pass, all);
    },

    // A5: formulas, inline and in the popup.
    async A5() {
      await show();
      const root = inlineRoot();
      await edit(root, 0, 0, '2'); await edit(root, 0, 1, '3'); await edit(root, 0, 2, '=A1+B1');
      await sleep(900);
      const first = text(root, 0, 2);
      await edit(root, 0, 0, '10'); await sleep(900);
      const updated = text(root, 0, 2);
      const dlg = await openPopup();
      const inPopup = text(dlg, 0, 2);
      await edit(dlg, 0, 1, '5'); await sleep(900);
      const popupUpdated = text(dlg, 0, 2);
      await closePopup('update');
      const afterApply = text(inlineRoot(), 0, 2);
      const pass = first === '5' && updated === '13' && inPopup === '13' && popupUpdated === '15' && afterApply === '15';
      return result('A5', pass, { inlineFirst: first, inlineAfterChange: updated, popupOpening: inPopup, popupAfterChange: popupUpdated, inlineAfterApply: afterApply });
    },

    // A6: undo and redo, inline and in the popup.
    async A6() {
      await show();
      const root = inlineRoot();
      await edit(root, 1, 0, 'one'); await sleep(700);
      await edit(root, 1, 0, 'two'); await sleep(700);
      root.querySelector('.elabftw-spreadsheet-readonly-undo').click(); await sleep(700);
      const inlineUndo = text(inlineRoot(), 1, 0);
      inlineRoot().querySelector('.elabftw-spreadsheet-readonly-redo').click(); await sleep(700);
      const inlineRedo = text(inlineRoot(), 1, 0);
      const dlg = await openPopup();
      await edit(dlg, 1, 0, 'three'); await sleep(300);
      const undoButton = [...dlg.querySelectorAll('button')].find(b => /^Undo/.test(b.title || b.getAttribute('aria-label') || ''));
      const redoButton = [...dlg.querySelectorAll('button')].find(b => /^Redo/.test(b.title || b.getAttribute('aria-label') || ''));
      undoButton.click(); await sleep(500);
      const popupUndo = text(dlg, 1, 0);
      redoButton.click(); await sleep(500);
      const popupRedo = text(dlg, 1, 0);
      await closePopup('cancel');
      const pass = inlineUndo === 'one' && inlineRedo === 'two' && popupUndo === 'two' && popupRedo === 'three';
      return result('A6', pass, { inlineUndo, inlineRedo, popupUndo, popupRedo });
    },

    // A7: rows and columns, added and deleted, inline and in the popup.
    async A7() {
      await show();
      const out = {};
      const r0 = rowCount(inlineRoot()); const c0 = colCount(inlineRoot());
      await contextMenu(inlineRoot(), cell(inlineRoot(), 1, 1), /Insert a new row after/);
      out.inlineRowAdded = rowCount(inlineRoot()) - r0;
      await contextMenu(inlineRoot(), cell(inlineRoot(), 2, 1), /Delete selected rows/);
      out.inlineRowDeleted = r0 - rowCount(inlineRoot());
      const header = inlineRoot().querySelector('.jss_worksheet thead td[data-x="1"]');
      await contextMenu(inlineRoot(), header, /Insert a new column after/);
      out.inlineColAdded = colCount(inlineRoot()) - c0;
      await contextMenu(inlineRoot(), inlineRoot().querySelector('.jss_worksheet thead td[data-x="2"]'), /Delete selected columns/);
      out.inlineColDeleted = c0 - colCount(inlineRoot());
      await sleep(900);
      out.tableMatchesAfterInline = snap().tableHash === snap().overlayHash;
      const dlg = await openPopup();
      const pr0 = rowCount(dlg); const pc0 = colCount(dlg);
      await contextMenu(dlg, cell(dlg, 1, 1), /Insert a new row after/);
      out.popupRowAdded = rowCount(dlg) - pr0;
      await contextMenu(dlg, cell(dlg, 2, 1), /Delete selected rows/);
      out.popupRowDeleted = pr0 - rowCount(dlg);
      await contextMenu(dlg, dlg.querySelector('.jss_worksheet thead td[data-x="1"]'), /Insert a new column after/);
      out.popupColAdded = colCount(dlg) - pc0;
      await contextMenu(dlg, dlg.querySelector('.jss_worksheet thead td[data-x="2"]'), /Delete selected columns/);
      out.popupColDeleted = pc0 - colCount(dlg);
      const addRow = [...dlg.querySelectorAll('button')].find(b => /Add one row/.test(b.title || b.getAttribute('aria-label') || ''));
      const addCol = [...dlg.querySelectorAll('button')].find(b => /Add one column/.test(b.title || b.getAttribute('aria-label') || ''));
      const br = rowCount(dlg); addRow.click(); await sleep(600); out.popupButtonRow = rowCount(dlg) - br;
      const bc = colCount(dlg); addCol.click(); await sleep(600); out.popupButtonCol = colCount(dlg) - bc;
      await closePopup('cancel');
      const pass = out.inlineRowAdded === 1 && out.inlineRowDeleted === 1 && out.inlineColAdded === 1 && out.inlineColDeleted === 1
        && out.popupRowAdded === 1 && out.popupRowDeleted === 1 && out.popupColAdded === 1 && out.popupColDeleted === 1
        && out.popupButtonRow === 1 && out.popupButtonCol === 1 && out.tableMatchesAfterInline;
      return result('A7', pass, out);
    },

    // A8: the look does not change when rows or columns are added or deleted.
    async A8() {
      await show();
      const root = inlineRoot();
      const sample = [[0, 0], [0, 1], [1, 0], [1, 1]];
      const before = sample.map(([r, c]) => style(cell(root, r, c)));
      const widthBefore = cell(root, 0, 0).getBoundingClientRect().width;
      await contextMenu(root, cell(root, 1, 1), /Insert a new row after/);
      await contextMenu(inlineRoot(), inlineRoot().querySelector('.jss_worksheet thead td[data-x="1"]'), /Insert a new column after/);
      await sleep(600);
      const mid = sample.map(([r, c]) => style(cell(inlineRoot(), r, c)));
      const insertedRow = style(cell(inlineRoot(), 2, 0)); const neighbourRow = style(cell(inlineRoot(), 1, 0));
      const insertedCol = style(cell(inlineRoot(), 0, 2)); const neighbourCol = style(cell(inlineRoot(), 0, 1));
      const keys = ['font', 'padding', 'border', 'align'];
      const sameLook = (a, b) => keys.every(k => a[k] === b[k]);
      await contextMenu(inlineRoot(), cell(inlineRoot(), 2, 0), /Delete selected rows/);
      await contextMenu(inlineRoot(), inlineRoot().querySelector('.jss_worksheet thead td[data-x="2"]'), /Delete selected columns/);
      await sleep(600);
      const after = sample.map(([r, c]) => style(cell(inlineRoot(), r, c)));
      const widthAfter = cell(inlineRoot(), 0, 0).getBoundingClientRect().width;
      const originalsUnchanged = before.every((s, i) => sameLook(s, mid[i]) && sameLook(s, after[i]));
      const pass = originalsUnchanged && sameLook(insertedRow, neighbourRow) && sameLook(insertedCol, neighbourCol) && Math.abs(widthBefore - widthAfter) < 1;
      return result('A8', pass, { originalsUnchanged, newRowLooksLikeNeighbour: sameLook(insertedRow, neighbourRow), newColumnLooksLikeNeighbour: sameLook(insertedCol, neighbourCol), widthBefore, widthAfter, insertedRow, neighbourRow, insertedCol, neighbourCol });
    },

    // A9: formatting buttons, inline and in the popup.
    async A9() {
      await show();
      const out = {};
      const apply = async (root, r, c, title) => {
        await select(root, r, c);
        // In the popup, Bold / Italic / Underline are toggles labelled "... selected cells".
        const popupLabel = { Bold: 'Bold selected cells', Italic: 'Italicize selected cells', Underline: 'Underline selected cells' }[title];
        const button = [...root.querySelectorAll('button, [title], [aria-label]')].find(b => (b.title || b.getAttribute('aria-label')) === title)
          || (popupLabel && root.querySelector(`[aria-label="${popupLabel}"]`));
        if (!button) throw new Error(`no "${title}" button`);
        button.click();
        await sleep(400);
      };
      const root = inlineRoot();
      const toggle = root.querySelector('.elabftw-spreadsheet-options-toggle');
      if (toggle && !root.querySelector('.elabftw-spreadsheet-format-bar')?.offsetParent) { toggle.click(); await sleep(500); }
      await apply(root, 0, 0, 'Bold'); out.inlineBold = style(cell(inlineRoot(), 0, 0)).font.includes('700') || style(cell(inlineRoot(), 0, 0)).font.includes('bold');
      await apply(inlineRoot(), 0, 1, 'Italic'); out.inlineItalic = style(cell(inlineRoot(), 0, 1)).font.includes('italic');
      await apply(inlineRoot(), 1, 0, 'Align right'); out.inlineAlignRight = style(cell(inlineRoot(), 1, 0)).align === 'right';
      const dlg = await openPopup();
      await apply(dlg, 1, 1, 'Bold'); out.popupBold = style(cell(dlg, 1, 1)).font.includes('700') || style(cell(dlg, 1, 1)).font.includes('bold');
      await apply(dlg, 2, 0, 'Italic'); out.popupItalic = style(cell(dlg, 2, 0)).font.includes('italic');
      await apply(dlg, 2, 1, 'Align center'); out.popupAlignCenter = style(cell(dlg, 2, 1)).align === 'center';
      await closePopup('update');
      out.popupBoldKept = (style(cell(inlineRoot(), 1, 1)).font.includes('700') || style(cell(inlineRoot(), 1, 1)).font.includes('bold'));
      return result('A9', Object.values(out).every(Boolean), out);
    },
  };

  return {
    checks,
    async setup(rows = 5, cols = 4) {
      window.confirm = () => true;
      state.uid = api().insertScratch(rows, cols);
      if (!state.uid) throw new Error('could not add the scratch table');
      await sleep(900);
      await show();
      return { uid: state.uid };
    },
    async run(id) {
      try { return await checks[id](); } catch (error) { return result(id, false, { error: String(error && error.message || error) }); }
    },
    async runAll(ids = Object.keys(checks)) {
      const results = [];
      for (const id of ids) results.push(await this.run(id));
      return results.map(r => ({ id: r.id, pass: r.pass, details: r.pass ? undefined : r.details }));
    },
    async teardown() {
      const removed = api().removeTable(state.uid);
      editor().execCommand('mceSave');
      await sleep(1500);
      return { removed };
    },
  };
})();
