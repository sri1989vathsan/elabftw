#!/usr/bin/env node
/**
 * Wording of the admin Announcements tab (admin.php?tab=9): no leftover text about a "dismissible banner", no "--" typed as a
 * dash, no "order attachment" wording, one "No announcements yet." sentence, and expiry dates without the raw "T" / "Z".
 * The account must be a team admin.
 *
 *   node tests/manual/announcements-text-check.js http://localhost:8973 EMAIL PASSWORD [screenshot.png]
 *
 * Makes one announcement with an expiry date and deletes it at the end.
 */
const { startChrome } = require('./cdp-lib');
const [base0, email, password, shot] = process.argv.slice(2);
if (!base0 || !email || !password) { console.error('usage: announcements-text-check.js BASEURL EMAIL PASSWORD [screenshot.png]'); process.exit(2); }
const base = base0.replace(/\/$/, '');
(async () => {
  const c = await startChrome();
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`); };
  let id = 0;
  const hdr = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  try {
    await c.login(base, email, password);
    await c.nav(`${base}/admin.php?tab=9`);
    id = await c.js(`const r = await fetch('/api/v2/announcements', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: 'text check', body: 'x', severity: 'info', expires_at: '2031-05-04T09:30:00Z' }) }); return Number((r.headers.get('Location') || '').split('/').pop())`);
    await c.nav(`${base}/admin.php?tab=9`);
    const text = await c.js(`return document.querySelector('[data-tabcontent="9"]').textContent.replace(/\\s+/g, ' ')`);
    const html = await c.js(`return document.querySelector('[data-tabcontent="9"]').innerHTML`);
    const intro = await c.js(`return [...document.querySelectorAll('[data-tabcontent="9"] > p, #createAnnouncementForm')].map(e => e.textContent).join(' ').replace(/\\s+/g, ' ')`);
    check('no leftover "dismissible banner" text in the intro or form', !/banner/i.test(intro), intro.match(/.{30}banner.{30}/i));
    check('no "--" typed as a dash', !/ -- /.test(text), text.match(/.{30} -- .{30}/));
    check('no "order attachment" wording', !/order attachment/i.test(text));
    check('empty state / intro mention the dashboard card', /Announcements card on the dashboard/.test(text));
    check('expiry date shown as "2031-05-04 09:30"', /Expires on 2031-05-04 09:30(?!:)/.test(text) && !/2031-05-04T/.test(text), text.match(/Expires on [^ ]+ ?[^ ]*/));
    check('edit form says links become links', /Web addresses in the message become links/.test(html));
    if (shot) await c.shot(shot);
  } finally {
    if (id) await c.js(`await fetch('/api/v2/announcements/${id}', { method: 'DELETE', credentials: 'same-origin', headers: ${hdr} }); return 1`).catch(() => {});
    await c.close();
  }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
