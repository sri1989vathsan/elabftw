#!/usr/bin/env node
/**
 * Boards: a dialog's dimmed overlay keeps to the right of an open side panel (avoidSidebar() in ProjectManagementBoard.svelte), and how
 * often the page reads the side panels' geometry while a dialog is simply open.
 *
 *   BASE=http://localhost:8988 node tests/manual/boards-avoid-sidebar-check.js EMAIL PASSWORD
 *
 * BASE must be the http dev proxy (tests/manual/dev-proxy.js). Headless Chrome, logged in as EMAIL; opens the Projects board, opens the
 * Folders side panel and the "New project" dialog, then checks, one line each (PASS/FAIL):
 *   - the overlay's left edge equals the panel's right edge (within 1 px) with the panel open
 *   - it goes back to 0 when the panel is closed, and follows again when the panel is opened
 *   - it follows a width change of the panel (--side-panel-width, as the resizer sets it)
 *   - it is removed with the dialog (no leftover listeners fire after the dialog closed: counted below)
 * and prints the number of getBoundingClientRect() calls on a .side-panel per second over 5 s with the dialog open and nothing happening
 * ("idle reads/s": about 6.7 with the 150 ms poll, about 0 with the observers) and over 5 s after the dialog was closed.
 * The same output for two builds of the front end can be compared; only the idle numbers should differ.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = (process.env.BASE || 'http://localhost:8988').replace(/\/$/, '');
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('usage: BASE=... boards-avoid-sidebar-check.js EMAIL PASSWORD'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boards-chrome-'));
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

(async () => {
  const c = await startChrome();
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
  try {
    await c.nav(`${base}/login.php`);
    await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
      const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
    await sleep(3500);
    await c.nav(`${base}/projectmanagement.php`);
    // counter on getBoundingClientRect of side panels, installed before anything is opened
    await c.js(`window.__panelReads = 0; const orig = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () { if (this.classList && this.classList.contains('side-panel')) window.__panelReads++; return orig.call(this); };
      window.__realRect = el => orig.call(el); return 1`);
    const opener = '#foldersPanelOpener';
    const panelState = `const p = document.getElementById('foldersPanel'); const open = !!p && !p.hidden; return JSON.stringify({ open, right: open ? window.__realRect(p).right : 0 })`;
    await c.js(`document.querySelector('${opener}').click(); return 1`);
    await sleep(1200);
    let st = JSON.parse(await c.js(panelState));
    check('Folders panel is open', st.open, `right edge ${Math.round(st.right)} px`);
    const btn = await c.js(`const b = [...document.querySelectorAll('button')].find(x => /New project/i.test(x.textContent) && x.classList.contains('pm-project-tab-new')) || [...document.querySelectorAll('button')].find(x => /New project/i.test(x.textContent)); if (!b) return false; b.click(); return true`);
    check('New project dialog opens', btn === true);
    await sleep(800);
    const left = () => c.js(`const o = document.querySelector('.pm-overlay'); return o ? parseFloat(o.style.left || '0') : -1`);
    let l = await left();
    check('overlay left edge = panel right edge (panel open)', Math.abs(l - st.right) <= 1, `overlay ${l}, panel ${Math.round(st.right)}`);
    // panel closed -> back to 0
    await c.js(`document.querySelector('${opener}').click(); return 1`);
    await sleep(1200);
    st = JSON.parse(await c.js(panelState));
    l = await left();
    check('overlay left edge = 0 when the panel is closed', !st.open && Math.abs(l) <= 1, `panel open ${st.open}, overlay ${l}`);
    // reopened -> follows again
    await c.js(`document.querySelector('${opener}').click(); return 1`);
    await sleep(1200);
    st = JSON.parse(await c.js(panelState));
    l = await left();
    check('overlay follows when the panel is opened again', st.open && Math.abs(l - st.right) <= 1, `overlay ${l}, panel ${Math.round(st.right)}`);
    // width change, as the resizer does it
    await c.js(`document.documentElement.style.setProperty('--side-panel-width', '520px'); return 1`);
    await sleep(1200);
    st = JSON.parse(await c.js(panelState));
    l = await left();
    check('overlay follows a width change of the panel', Math.abs(l - st.right) <= 1 && st.right > 400, `overlay ${l}, panel ${Math.round(st.right)}`);
    // idle: nothing happens for 5 s
    await c.js('window.__panelReads = 0; return 1');
    await sleep(5000);
    const idleOpen = await c.js('return window.__panelReads');
    console.log(`idle reads/s with the dialog open: ${(idleOpen / 5).toFixed(1)} (${idleOpen} calls in 5 s)`);
    // close the dialog (Escape or click outside), then idle again
    await c.js(`const o = document.querySelector('.pm-overlay'); if (o) o.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1`);
    await sleep(800);
    const gone = await c.js(`return !document.querySelector('.pm-overlay')`);
    check('dialog closes', gone === true);
    await c.js('window.__panelReads = 0; return 1');
    await sleep(5000);
    const idleClosed = await c.js('return window.__panelReads');
    console.log(`idle reads/s after the dialog was closed: ${(idleClosed / 5).toFixed(1)} (${idleClosed} calls in 5 s)`);
    check('nothing keeps reading the panels after the dialog closed', idleClosed <= 2, `${idleClosed} calls in 5 s`);
  } finally {
    c.close();
  }
  const failed = results.filter(r => !r).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(2); });
