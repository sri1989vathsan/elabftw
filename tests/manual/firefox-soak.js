/*
 * Run the spreadsheet soak test in Firefox (or any browser).
 *
 *   1. Open a NEW EMPTY experiment in edit mode (not one with spreadsheets you care about).
 *   2. Open the console (Cmd+Option+K). If Firefox asks, type  allow pasting  and press Enter.
 *   3. Copy everything below the line of dashes into the console and press Enter.
 *   4. Keep this window fully visible (not covered, not minimized) and stay on this tab:
 *      a hidden tab stalls the run. It takes about 25 to 30 minutes.
 *   5. Check progress at any time:     window.spreadsheetSoakProgress
 *   6. When it prints its verdict, copy the whole result to send it on:
 *                                       copy(JSON.stringify(window.__soakResult))
 *
 * A shorter run: change  { seed: 20261021, sessions: 3 }  to  { seed: 20261021, sessions: 1, quick: true }
 */

// ---------------------------------------------------------------------------------------------
await new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = '/__tests/spreadsheet-soak.js?' + Date.now();
  s.onload = res;
  s.onerror = rej;
  document.head.appendChild(s);
});
window.__soakDone = false;
spreadsheetSoak({ seed: 20261021, sessions: 3 }).then(r => {
  window.__soakDone = true;
  window.__soakResult = r;
  console.log(r.verdict, '| data loss:', r.dataLossCount, '| other problems:', r.otherFailureCount);
});
