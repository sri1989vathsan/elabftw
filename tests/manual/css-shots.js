#!/usr/bin/env node
/**
 * Screenshots of the same pages in light, dark and midnight, compact and comfortable, to compare two builds of the stylesheets pixel by pixel
 * (css-pixel-diff.py compares two folders). Headless Chrome, logged in, 1400x900, animations and the caret frozen.
 *
 *   BASE=http://localhost:8988 node tests/manual/css-shots.js EMAIL PASSWORD OUTDIR [only,pagenames]
 *
 * Needs the entries "checks fixture" and "perf: five spreadsheets" (run-console-checks.js and bundle-split-perf.js seed make them) and, for the
 * well plate page, a well plate in an entry: this script inserts one into a scratch entry "css shots plate" the first time.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = (process.env.BASE || 'http://localhost:8988').replace(/\/$/, '');
const [email, password, outDir, only] = process.argv.slice(2);
if (!email || !password || !outDir) { console.error('usage: BASE=... css-shots.js EMAIL PASSWORD OUTDIR [only,pagenames]'); process.exit(2); }
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


async function waitEditor(c) { for (let i = 0; i < 60; i++) { await sleep(1000); if (await c.js('return !!(window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized)').catch(() => false)) return true; } return false; }
const find = (c, title) => c.js(`const r = await fetch('/api/v2/experiments?q=' + encodeURIComponent(${JSON.stringify(title)}) + '&limit=5', { credentials: 'same-origin' }); const j = await r.json(); const e = j.find(x => x.title === ${JSON.stringify(title)}); return e ? e.id : 0`);

async function ensurePlate(c) {
  const hdr = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  const found = await find(c, 'css shots plate');
  if (found) return found;
  const id = await c.js(`const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: 'css shots plate' }) }); return Number(r.headers.get('Location').split('/').pop())`);
  await c.nav(`${base}/experiments.php?mode=edit&id=${id}`);
  if (!await waitEditor(c)) throw new Error('editor did not start');
  await c.js(`
    const ed = tinymce.activeEditor;
    const rows = 8, cols = 12;
    const data = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    data[0][0] = 'ctl'; data[1][1] = 'a'; data[2][2] = 'b';
    ed.execCommand('elabftwInsertSpreadsheetData', false, { data, cols, rows, kind: 'well-plate', plateSize: 96, caption: '96-well plate', cellStyles: { B2: 'background-color:#ff0000', C3: 'background-color:#00aa00' } });
    await new Promise(r => setTimeout(r, 1200));
    await fetch('/api/v2/experiments/${id}', { method: 'PATCH', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ body: ed.getContent() }) });
    return 1`);
  return id;
}

(async () => {
  const c = await startChrome();
  try {
    await c.nav(`${base}/login.php`);
    await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
      const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
    await sleep(3500);
    const fixture = await find(c, 'checks fixture');
    const five = await find(c, 'perf: five spreadsheets');
    const plate = await ensurePlate(c);
    fs.mkdirSync(outDir, { recursive: true });
    const pages = [
      ['dashboard', `${base}/dashboard.php`],
      ['list', `${base}/experiments.php`],
      ['view-fixture', `${base}/experiments.php?mode=view&id=${fixture}`],
      ['view-five', `${base}/experiments.php?mode=view&id=${five}`],
      ['view-plate', `${base}/experiments.php?mode=view&id=${plate}`],
      ['edit-fixture', `${base}/experiments.php?mode=edit&id=${fixture}`, true],
      ['edit-plate', `${base}/experiments.php?mode=edit&id=${plate}`, true],
      ['standalone-sheet', `${base}/spreadsheet.html`],
      ['admin-team', `${base}/admin.php?tab=1`],
      ['database', `${base}/database.php`],
      ['templates', `${base}/templates.php`],
      ['orders', `${base}/orders.php`],
      ['projectmanagement', `${base}/projectmanagement.php`],
      ['calendar', `${base}/calendar.php`],
      ['ucp', `${base}/ucp.php`],
      ['sysconfig', `${base}/sysconfig.php`],
      // pages in a state: a side panel open, the well plate dialog open (it is reached through the Insert menu of the editor)
      ['panel-contents', `${base}/experiments.php?mode=view&id=${fixture}`, false, `document.getElementById('tocPanelOpener').click(); await new Promise(r => setTimeout(r, 1500));`],
      ['panel-folders', `${base}/experiments.php`, false, `document.getElementById('foldersPanelOpener').click(); await new Promise(r => setTimeout(r, 2500));`],
      ['panel-search', `${base}/experiments.php`, false, `document.getElementById('favoritesPanelOpener').click(); await new Promise(r => setTimeout(r, 1500));`],
      ['panel-todo', `${base}/dashboard.php`, false, `document.getElementById('todolistPanelOpener').click(); await new Promise(r => setTimeout(r, 2000));`],
      ['plate-dialog', `${base}/experiments.php?mode=edit&id=${plate}`, true, `
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const ed = tinymce.activeEditor;
        const t = ed.getBody().querySelector('table.elabftw-spreadsheet');
        ed.selection.select(t.querySelector('td, th') || t, true); ed.nodeChanged(); await wait(800);
        const click = async (sel, re) => { const el = [...document.querySelectorAll(sel)].find(e => re.test((e.getAttribute('aria-label') || e.textContent || '').trim())); if (el) el.click(); await wait(900); };
        await click('.tox-tbtn', /Spreadsheet tools/); await click('.tox-collection__item', /^Edit selected spreadsheet/);
        await wait(1500);`],
    ];
    const themes = [['light', ''], ['dark', 'dark-mode'], ['midnight', 'midnight']];
    const sizes = ['compact', 'comfortable'];
    for (const [name, url, editor, action] of pages) {
      if (only && !only.split(',').includes(name)) continue;
      await c.nav(url);
      if (editor) await waitEditor(c);
      await sleep(1500);
      if (action) {
        try { await c.js(action); } catch (e) { console.log('action failed', name, String(e.message).slice(0, 100)); }
        console.log(name, 'state:', await c.js(`return { dialog: !!document.querySelector('.wp-dialog'), panel: !!document.querySelector('.side-panel:not([hidden])') }`));
      }
      for (const [tname, tclass] of themes) {
        for (const size of sizes) {
          await c.js(`const r = document.documentElement; r.classList.remove('dark-mode', 'midnight'); if (${JSON.stringify(tclass)}) r.classList.add(${JSON.stringify(tclass)}); r.setAttribute('data-ui-size', ${JSON.stringify(size)});
            if (!document.getElementById('shots-freeze')) { const s = document.createElement('style'); s.id = 'shots-freeze'; s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } '; document.head.appendChild(s); }
            document.activeElement && document.activeElement.blur && document.activeElement.blur(); scrollTo(0, 0); return 0`);
          await sleep(500);
          const shot = await c.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(outDir, `${name}__${tname}__${size}.png`), Buffer.from(shot.data, 'base64'));
        }
      }
      console.log('shot', name);
    }
  } finally {
    c.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
