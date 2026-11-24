#!/usr/bin/env node
/**
 * The Useful links page must show its title once (the page title from base.html), not twice (that plus a second heading in
 * other-links.html). Headless Chrome:
 *
 *   node tests/manual/other-links-title-check.js http://localhost:8973 EMAIL PASSWORD [screenshot.png]
 *
 * Counts visible h1/h2 elements whose text is "Useful links": expect exactly 1 (before the fix: 2).
 */
const { startChrome } = require('./cdp-lib');
const [base0, email, password, shot] = process.argv.slice(2);
if (!base0 || !email || !password) { console.error('usage: other-links-title-check.js BASEURL EMAIL PASSWORD [screenshot.png]'); process.exit(2); }
const base = base0.replace(/\/$/, '');
(async () => {
  const c = await startChrome();
  let ok = true;
  try {
    await c.login(base, email, password);
    await c.nav(`${base}/other-links.php`);
    const n = await c.js(`return [...document.querySelectorAll('h1, h2, h3')].filter(h => h.offsetParent !== null && h.textContent.trim() === 'Useful links').length`);
    ok = n === 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  "Useful links" heading shown ${n} time(s), expected 1`);
    if (shot) await c.shot(shot);
  } finally { await c.close(); }
  process.exit(ok ? 0 : 1);
})();
