/**
 * One paste for Firefox: runs the fault, regression and acceptance checks in order and prints a
 * short report. Before this, paste these four files into the console (one after the other) on an
 * experiment's EDIT page (use a throwaway experiment), logged in:
 *   spreadsheet-faults.js, spreadsheet-regression.js, spreadsheet-acceptance.js
 * A7 and A8 are left out: they need real mouse clicks (see FIREFOX.md).
 * Result: window.__ffReport, and a PASS/FAIL list printed at the end.
 */
(async () => {
  window.confirm = () => true;
  const report = {};
  report.faults = await spreadsheetFaults.runAll();
  await spreadsheetRegression.setup();
  report.regression = await spreadsheetRegression.runAll();
  await spreadsheetRegression.teardown();
  await spreadsheetAcceptance.setup();
  report.acceptance = await spreadsheetAcceptance.runAll(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A9']);
  await spreadsheetAcceptance.teardown();
  window.__ffReport = report;
  const lines = Object.entries(report).flatMap(([group, list]) =>
    list.map(r => `${group} ${r.id}: ${r.pass ? 'PASS' : 'FAIL ' + JSON.stringify(r.details).slice(0, 200)}`));
  console.log(lines.join('\n'));
  return lines;
})();
