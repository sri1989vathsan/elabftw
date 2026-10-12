/**
 * Regression checks for earlier spreadsheet fixes (checklist section 7). Run from the browser console
 * on an experiment's EDIT page (logged in), after pasting this file and spreadsheet-acceptance.js:
 *
 *     await spreadsheetRegression.setup();
 *     await spreadsheetRegression.runAll();      // or .run('R6')
 *     await spreadsheetRegression.teardown();
 *
 * Covers R6 (main-text undo does not touch table edits), R7 (an autosave while typing does not
 * interrupt the typing) and R4 (formatting set in the
 * popup is kept). R1, R2, R8 and R9-R11 need a visible browser tab, real clicks or a decision, and stay manual.
 */
window.spreadsheetRegression = (() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const api = () => window.elabftwSpreadsheetDiagnostics;
  const editor = () => tinymce.activeEditor;
  const state = {};
  const snap = () => api().snapshot(true).find(entry => entry.uid === state.uid);
  const overlay = () => api().overlayElement(state.uid);
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);
  const result = (id, pass, details) => ({ id, pass, details });

  async function show() {
    const table = editor().getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${state.uid}"]`);
    table?.scrollIntoView({ block: 'center' });
    await sleep(350);
    api().mountLive(state.uid);
    await sleep(600);
  }
  async function openEditor(r, c) {
    const td = overlay().querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    if (!box) throw new Error('no cell editor');
    return box;
  }
  const enter = box => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const type = (box, value) => { box.value = value; box.dispatchEvent(new Event('input', { bubbles: true })); };

  const checks = {
    // R6: Ctrl+Z in the main text does not undo spreadsheet edits.
    async R6() {
      await show();
      editor().insertContent('<p id="undo-probe">undo probe text</p>');
      editor().undoManager.add();
      const box = await openEditor(0, 0); type(box, 'kept-by-table'); enter(box);
      await sleep(1200);
      // The Undo command (what Ctrl+Z and the toolbar button run) is what the table protection hooks into.
      editor().execCommand('Undo');
      await sleep(900);
      const probeGone = !editor().getBody().querySelector('#undo-probe');
      const tableStillHasEdit = JSON.stringify(snap()?.tableData ?? []).includes('kept-by-table');
      // clean up whatever is left of the probe
      editor().getBody().querySelector('#undo-probe')?.remove();
      return result('R6', probeGone && tableStillHasEdit, { probeRemovedByUndo: probeGone, tableEditSurvivedUndo: tableStillHasEdit });
    },

    // R7: an autosave / content read while a cell is mid-edit does not interrupt the typing.
    async R7() {
      await show();
      const box = await openEditor(1, 1);
      type(box, 'half-typed');
      // Autosave reads the content; the app defers its save while a cell is being edited, and a
      // manual Save click ends the edit by design, so only the content read is checked here.
      editor().getContent();
      await sleep(400);
      const stillOpen = !!visibleRescue() && visibleRescue().value === 'half-typed';
      enter(visibleRescue() ?? box);
      await sleep(1200);
      const reachedTable = JSON.stringify(snap().tableData).includes('half-typed');
      return result('R7', stillOpen && reachedTable, { editorStillOpenWithText: stillOpen, valueReachedTableAfterEnter: reachedTable });
    },

    // R8 (deleting a spreadsheet, then Ctrl+Z) is not automated: by design (fix fa5624d11) Ctrl+Z in the
    // main text restores only the text and leaves spreadsheets as they are, so a deleted spreadsheet
    // is NOT brought back. See the decision item in CHECKLIST.md.

    // R4: formatting set in the popup is kept after Update and a save.
    async R4() {
      await show();
      overlay().querySelector('.elabftw-spreadsheet-readonly-open-editor').click();
      let dialog = null;
      for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
      await sleep(900);
      const td = dialog.querySelector('td[data-x="3"][data-y="3"]');
      const rect = td.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, buttons: 1 };
      td.dispatchEvent(new PointerEvent('pointerdown', init)); td.dispatchEvent(new MouseEvent('mousedown', init));
      td.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 })); td.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
      await sleep(400);
      dialog.querySelector('[aria-label="Bold selected cells"]').click();
      await sleep(500);
      [...dialog.querySelectorAll('button')].find(b => /^Update/.test(b.textContent.trim())).click();
      for (let i = 0; i < 60 && document.querySelector('.inline-spreadsheet-dialog'); i++) await sleep(50);
      await sleep(1500);
      editor().execCommand('mceSave');
      await sleep(1200);
      const inlineBold = getComputedStyle(overlay().querySelector('td[data-x="3"][data-y="3"]')).fontWeight === '700';
      const savedBold = /font-weight:\s*(bold|700)/.test(editor().getBody().querySelector(`table[data-elabftw-spreadsheet-uid="${state.uid}"]`).rows[4]?.cells[4]?.getAttribute('style') || '');
      return result('R4', inlineBold && savedBold, { boldShownInline: inlineBold, boldInSavedTable: savedBold });
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
      const out = [];
      for (const id of ids) out.push(await this.run(id));
      return out.map(r => ({ id: r.id, pass: r.pass, details: r.pass ? undefined : r.details }));
    },
    async teardown() {
      const removed = api().removeTable(state.uid);
      editor().execCommand('mceSave');
      await sleep(1500);
      return { removed };
    },
  };
})();
