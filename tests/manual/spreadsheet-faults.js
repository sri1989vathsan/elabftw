/**
 * Deliberate-fault tests for the sync checks (checklist S7-S11). Each one creates a disagreement
 * between the inline grid, the popup and the saved table, and checks that the editor notices it,
 * keeps a recovery copy of the version that is replaced, and ends with grid and table in agreement.
 *
 * Run from the browser console on an experiment's EDIT page (logged in), after pasting this file:
 *
 *     const report = await spreadsheetFaults.runAll();
 *
 * Uses a scratch table that is removed again at the end.
 */
window.spreadsheetFaults = (() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const api = () => window.elabftwSpreadsheetDiagnostics;
  const editor = () => tinymce.activeEditor;
  const state = {};
  const table = () => editor().getBody().querySelector(`table.elabftw-spreadsheet[data-elabftw-spreadsheet-uid="${state.uid}"]`);
  const snap = () => api().snapshot(true).find(entry => entry.uid === state.uid);
  const overlay = () => api().overlayElement(state.uid);
  const visibleRescue = () => [...document.querySelectorAll('.elabftw-spreadsheet-rescue-input')].find(el => !el.hidden);
  const dataCells = () => [...table().querySelectorAll('td')].filter(cell => !cell.classList.contains('spreadsheet-coordinate'));

  async function show() {
    table().scrollIntoView({ block: 'center' });
    await sleep(350);
    api().mountLive(state.uid);
    await sleep(600);
  }
  async function edit(root, r, c, value) {
    const td = root.querySelector(`td[data-x="${c}"][data-y="${r}"]`);
    const rect = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    let box = null;
    for (let i = 0; i < 40 && !(box = visibleRescue()); i++) await sleep(25);
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(60);
  }
  // The list of recovery copies keeps only the last few, so its length stops changing when it is
  // full; the number of copies made is counted from the log of events instead.
  // The event log keeps only the last 500 entries, so counting by position stops working once it is full:
  // events are counted by their time stamp instead ("since" is a performance.now() value from mark()).
  const mark = () => Math.round(performance.now());
  const recoveryCount = since => api().events().filter(entry => entry.ev === 'recovery-copy' && entry.t >= since).length;
  const lastRecovery = () => api().recoveryCopies().slice(-1)[0];
  const eventsSince = start => api().events().filter(entry => entry.t >= start).map(entry => `${entry.ev}${entry.status ? ':' + entry.status : ''}`);
  const result = (id, pass, details) => ({ id, pass, details });

  const faults = {
    // S7: the table is changed behind the grid's back, then a pre-save check runs.
    async S7() {
      await show();
      await edit(overlay(), 0, 0, 'base'); await sleep(900);
      const start = mark();
      dataCells()[5].textContent = 'S7-external';
      await sleep(300);
      const checks = api().verify('fault-S7').filter(entry => entry.uid === state.uid);
      await sleep(500);
      const after = snap();
      const pass = checks[0]?.status === 'overlay-stale' && recoveryCount(start) === 1
        && JSON.stringify(after.tableData).includes('S7-external') && JSON.stringify(after.overlayData ?? '').includes('S7-external');
      return result('S7', pass, { status: checks[0]?.status, newRecoveryCopies: recoveryCount(start), tableAndGridShowTheNewerVersion: JSON.stringify(after.overlayData ?? '').includes('S7-external'), events: eventsSince(start) });
    },

    // S8: the grid has an unwritten edit AND the table was changed by someone else.
    async S8() {
      await show();
      await sleep(900);
      const start = mark();
      await edit(overlay(), 2, 1, 'S8-grid');
      dataCells()[2].textContent = 'S8-external';
      const checks = api().verify('fault-S8').filter(entry => entry.uid === state.uid);
      await sleep(1200);
      const after = snap();
      const pass = checks[0]?.status === 'conflict' && recoveryCount(start) === 1 && lastRecovery().html.includes('S8-external')
        && JSON.stringify(after.tableData).includes('S8-grid') && after.tableHash === after.overlayHash;
      return result('S8', pass, { status: checks[0]?.status, recoveryHoldsTheOtherVersion: !!lastRecovery()?.html.includes('S8-external'), gridEditWrittenToTable: JSON.stringify(after.tableData).includes('S8-grid'), gridAndTableAgree: after.tableHash === after.overlayHash });
    },

    // S9: an older grid writes over a table that was changed since it last synced.
    async S9() {
      await show();
      await sleep(900);
      const start = mark();
      dataCells()[3].textContent = 'S9-external';
      await sleep(300);
      await edit(overlay(), 3, 2, 'S9-grid');
      await sleep(1300);
      const events = eventsSince(start);
      const pass = events.includes('stale-overlay-write') && recoveryCount(start) > 0 && lastRecovery().html.includes('S9-external');
      return result('S9', pass, { staleWriteDetected: events.includes('stale-overlay-write'), recoveryHoldsTheNewerVersion: !!lastRecovery()?.html.includes('S9-external'), events });
    },

    // S10: the popup is applied after the table changed while it was open.
    async S10() {
      await show();
      await sleep(900);
      const start = mark();
      overlay().querySelector('.elabftw-spreadsheet-readonly-open-editor').click();
      let dialog = null;
      for (let i = 0; i < 60 && !(dialog = document.querySelector('.inline-spreadsheet-dialog')); i++) await sleep(50);
      await sleep(500);
      await edit(dialog, 1, 3, 'S10-popup');
      dataCells()[6].textContent = 'S10-external';
      [...dialog.querySelectorAll('button')].find(b => /^Update/.test(b.textContent.trim())).click();
      for (let i = 0; i < 60 && document.querySelector('.inline-spreadsheet-dialog'); i++) await sleep(50);
      await sleep(1500);
      const after = snap();
      const apply = api().events().filter(entry => entry.t >= start).find(entry => entry.ev === 'popup-apply');
      const pass = !!apply && apply.openedHash !== apply.tableHash && recoveryCount(start) === 1 && lastRecovery().html.includes('S10-external')
        && JSON.stringify(after.tableData).includes('S10-popup') && after.tableHash === after.overlayHash;
      return result('S10', pass, { tableChangedWhilePopupWasOpen: !!apply && apply.openedHash !== apply.tableHash, recoveryHoldsTheOtherVersion: !!lastRecovery()?.html.includes('S10-external'), popupEditApplied: JSON.stringify(after.tableData).includes('S10-popup'), gridAndTableAgree: after.tableHash === after.overlayHash });
    },

    // S11: a recovery copy can be restored.
    async S11() {
      const copies = api().recoveryCopies();
      const index = copies.map((copy, i) => ({ copy, i })).filter(entry => entry.copy.uid === state.uid && entry.copy.html.includes('S10-external')).pop()?.i;
      if (index === undefined) return result('S11', false, { error: 'no recovery copy from S10 to restore' });
      const ok = api().restoreRecovery(index);
      await sleep(1500);
      const after = snap();
      return result('S11', ok && JSON.stringify(after.tableData).includes('S10-external') && after.tableHash === after.overlayHash, { restored: ok, tableHasTheRecoveredValue: JSON.stringify(after.tableData).includes('S10-external'), gridAndTableAgree: after.tableHash === after.overlayHash });
    },
  };

  return {
    faults,
    async runAll() {
      window.confirm = () => true;
      state.uid = api().insertScratch(4, 4);
      await sleep(1000);
      const out = [];
      try {
        for (const id of Object.keys(faults)) {
          try { out.push(await faults[id]()); } catch (error) { out.push(result(id, false, { error: String(error && error.message || error) })); }
        }
      } finally {
        api().removeTable(state.uid);
        editor().execCommand('mceSave');
        await sleep(1500);
      }
      return out.map(entry => ({ id: entry.id, pass: entry.pass, details: entry.pass ? undefined : entry.details }));
    },
  };
})();
