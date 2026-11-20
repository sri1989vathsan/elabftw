#!/usr/bin/env node
/**
 * Runs the console checks of tests/manual (the ones documented as "paste into the console on page X") in headless Chrome, one after the other,
 * and prints PASS/FAIL per check and per failing item. Used to compare two builds of the front end (same database, same fixture): the output of a
 * build must equal the output of the one before it.
 *
 *   BASE=http://localhost:8988 node tests/manual/run-console-checks.js EMAIL PASSWORD [only,names]
 *
 * BASE must be the http dev proxy (tests/manual/dev-proxy.js), which also serves /__tests/<file>. It makes (once) an entry "checks fixture" with 8 headings of
 * three levels and two spreadsheets, and uses it for the view-page checks. Checks: print-check, toc-rows-check, toc-select-bar-check,
 * sidebar-x-consistency-check (view and edit page), reminder-chip-check and pin-check (two passes each), admin-team-check, whats-new-button-check.
 * Not covered here: sidebar-wheel-check.js, guide-cards-check.js and whats-new-popup-check.js are their own scripts.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = (process.env.BASE || 'http://localhost:8988').replace(/\/$/, '');
const [email, password, only] = process.argv.slice(2);
if (!email || !password) { console.error('usage: BASE=... run-console-checks.js EMAIL PASSWORD [only,names]'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1400,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up */ } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, d => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const js = async code => {
    const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'js error');
    return r.result.value;
  };
  const nav = async url => {
    await send('Page.navigate', { url });
    await sleep(1500);
    for (let i = 0; i < 40; i++) { if (await js('return document.readyState').catch(() => '') === 'complete') break; await sleep(250); }
    await sleep(2500);
  };
  return { send, js, nav, close() { try { ws.close(); } catch { /* */ } proc.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1500); } };
}

async function waitEditor(c) {
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await c.js('return !!(window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized)').catch(() => false)) return true; }
  return false;
}

async function ensureFixture(c) {
  const hdr = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  const found = await c.js(`const r = await fetch('/api/v2/experiments?q=' + encodeURIComponent('checks fixture') + '&limit=5', { credentials: 'same-origin' }); const j = await r.json(); const e = j.find(x => x.title === 'checks fixture'); return e ? e.id : 0`);
  if (found) return found;
  const id = await c.js(`const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: 'checks fixture' }) }); return Number(r.headers.get('Location').split('/').pop())`);
  await c.nav(`${base}/experiments.php?mode=edit&id=${id}`);
  if (!await waitEditor(c)) throw new Error('editor did not start for the fixture');
  await c.js(`
    const ed = tinymce.activeEditor;
    const levels = [1, 2, 3, 2, 3, 1, 2, 3];
    for (let i = 0; i < levels.length; i++) {
      ed.insertContent('<h' + levels[i] + '>Section ' + (i + 1) + ' level ' + levels[i] + '</h' + levels[i] + '><p>' + 'Lorem ipsum dolor sit amet. '.repeat(8) + '</p>');
      if (i === 2 || i === 5) {
        const rows = 6, cols = 5;
        const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, cc) => r === 0 ? 'H' + (cc + 1) : String(r * 3 + cc)));
        ed.execCommand('elabftwInsertSpreadsheetData', false, { data, cols, rows, kind: 'standard', caption: 'Sheet ' + (i + 1) });
        await new Promise(r => setTimeout(r, 800));
      }
    }
    await fetch('/api/v2/experiments/${id}', { method: 'PATCH', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ body: ed.getContent() }) });
    return 1`);
  return id;
}

const checks = [
  { name: 'print-check', file: 'print-check.js', fn: 'printCheck', page: id => `${base}/experiments.php?mode=view&id=${id}` },
  { name: 'toc-rows-check', file: 'toc-rows-check.js', fn: 'tocRowsCheck', page: id => `${base}/experiments.php?mode=view&id=${id}` },
  { name: 'toc-select-bar-check', file: 'toc-select-bar-check.js', fn: 'tocSelectBarCheck', page: id => `${base}/experiments.php?mode=view&id=${id}` },
  { name: 'sidebar-x-view', file: 'sidebar-x-consistency-check.js', fn: 'sidebarXConsistencyCheck', page: id => `${base}/experiments.php?mode=view&id=${id}` },
  { name: 'sidebar-x-edit', file: 'sidebar-x-consistency-check.js', fn: 'sidebarXConsistencyCheck', page: id => `${base}/experiments.php?mode=edit&id=${id}`, editor: true },
  { name: 'reminder-chip-check', file: 'reminder-chip-check.js', fn: 'reminderChipCheck', page: () => `${base}/dashboard.php`, twice: true },
  { name: 'pin-check', file: 'pin-check.js', fn: 'pinCheck', page: () => `${base}/experiments.php`, twice: true },
  { name: 'admin-team-check', file: 'admin-team-check.js', fn: 'adminTeamCheck', page: () => `${base}/admin.php?tab=1` },
  { name: 'whats-new-button-check', file: 'whats-new-button-check.js', fn: 'whatsNewButtonCheck', page: () => `${base}/dashboard.php` },
];

(async () => {
  const c = await startChrome();
  const summary = {};
  try {
    await c.nav(`${base}/login.php`);
    await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
      const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
    await sleep(3500);
    const fixture = await ensureFixture(c);
    console.log('fixture entry', fixture);
    const errors = [];
    for (const check of checks) {
      if (only && !only.split(',').includes(check.name)) continue;
      const run = async () => {
        await c.nav(check.page(fixture));
        if (check.editor && !await waitEditor(c)) return { pass: false, results: [{ name: 'editor started', ok: false }] };
        await c.js(`await new Promise((r, j) => { const s = document.createElement('script'); s.src = '/__tests/${check.file}?' + Date.now(); s.onload = r; s.onerror = j; document.head.appendChild(s); }); return 1`);
        const raw = await c.js(`window.__pageErrors = []; addEventListener('error', e => window.__pageErrors.push(String(e.message))); return JSON.stringify(await window.${check.fn}())`);
        return JSON.parse(raw);
      };
      try {
        let res = await run();
        if (check.twice) res = await run();
        const bad = res.results.filter(r => !r.ok);
        summary[check.name] = { pass: res.pass !== false && bad.length === 0, total: res.results.length, failed: bad.map(b => `${b.name}${b.detail !== undefined ? ' -> ' + JSON.stringify(b.detail).slice(0, 160) : ''}`) };
      } catch (e) {
        summary[check.name] = { pass: false, total: 0, failed: ['exception: ' + String(e.message).slice(0, 300)] };
      }
      const s = summary[check.name];
      console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${check.name} (${s.total} items)`);
      s.failed.forEach(f => console.log('        - ' + f));
    }
    fs.writeFileSync(path.join(process.env.CHECKS_OUT || os.tmpdir(), `console-checks-${process.env.LABEL || 'run'}.json`), JSON.stringify(summary, null, 1));
  } finally {
    c.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
