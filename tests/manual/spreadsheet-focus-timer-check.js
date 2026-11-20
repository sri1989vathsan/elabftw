#!/usr/bin/env node
/**
 * Spreadsheet focus-reclaim poll: timer wakeups per second with 5 editable sheets on the page, and the reclaim itself.
 *
 *   BASE=http://localhost:8988 node tests/manual/spreadsheet-focus-timer-check.js EMAIL PASSWORD
 *
 * BASE must be the http dev proxy (tests/manual/dev-proxy.js). Headless Chrome; makes a new empty experiment, opens it for editing and puts
 * 5 spreadsheets into the text. window.setInterval is wrapped before the page loads, so every callback of an interval of 40-60 ms
 * (the 50 ms focus poll) is counted. Prints the wakeups per second
 *   - with the live sheets and no focus in any grid (idle) : 20/s per live editable sheet with one poll per sheet, 0 with the shared poll
 *   - with focus in one grid                               : 20/s per live sheet before, 20/s after
 *   - after leaving the grids again                        : 20/s per live sheet before, 0/s after
 * Whether the reclaim itself still works (focus back into the grid after jspreadsheet drops its cell editor) is covered by the spreadsheet soak
 * (typing, popup and filler scenarios), not here.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = (process.env.BASE || 'http://localhost:8988').replace(/\/$/, '');
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('usage: BASE=... spreadsheet-focus-timer-check.js EMAIL PASSWORD'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-chrome-'));
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
  // a headless page has no system focus: without this, element.focus() sets activeElement but no focusin event reaches the page
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
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
    // count the callbacks of 40-60 ms intervals in every page that loads from now on
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__ticks50 = 0; window.__intervals50 = 0;
      const realSet = window.setInterval.bind(window);
      window.setInterval = function (fn, delay, ...rest) {
        if (typeof fn === 'function' && delay >= 40 && delay <= 60) {
          window.__intervals50++;
          return realSet(function () { window.__ticks50++; return fn.apply(this, arguments); }, delay, ...rest);
        }
        return realSet(fn, delay, ...rest);
      };` });
    await c.nav(`${base}/login.php`);
    await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
      const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
    await sleep(3500);
    const hdr = `{ 'Content-Type': 'application/json' }`;
    const id = await c.js(`const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: 'focus timer fixture' }) }); return Number(r.headers.get('Location').split('/').filter(Boolean).pop())`);
    await c.nav(`${base}/experiments.php?mode=edit&id=${id}`);
    for (let i = 0; i < 30 && !await c.js('return !!(window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized)'); i++) await sleep(500);
    await c.js(`
      const ed = tinymce.activeEditor;
      const enc = v => btoa(unescape(encodeURIComponent(JSON.stringify(v))));
      const tableHtml = i => {
        const rows = 6, cols = 5;
        const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, cc) => r === 0 ? 'H' + (cc + 1) : String(r * 3 + cc + i)));
        const head = '<tr><th class="spreadsheet-coordinate"></th>' + data[0].map((_, cc) => '<th class="spreadsheet-coordinate">' + String.fromCharCode(65 + cc) + '</th>').join('') + '</tr>';
        const body = data.map((row, r) => '<tr><th class="spreadsheet-coordinate">' + (r + 1) + '</th>' + row.map(v => '<td>' + v + '</td>').join('') + '</tr>').join('');
        return '<table class="elabftw-spreadsheet" data-spreadsheet="' + enc({ data, rows, cols, kind: 'standard' }) + '"><thead>' + head + '</thead><tbody>' + body + '</tbody></table><p>Text ' + i + '</p>';
      };
      ed.setContent('<p>Timer test.</p>' + [0, 1, 2, 3, 4].map(tableHtml).join(''));
      return 1`);
    await sleep(4000);
    // the sheets far from the viewport stay previews until they are pressed: make all of them live (editable) grids
    for (let round = 0; round < 8; round++) {
      const left = await c.js(`
        const previews = [...document.querySelectorAll('.elabftw-spreadsheet-editor-overlay.elabftw-spreadsheet-preview')];
        for (const el of previews) {
          el.scrollIntoView({ block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          const r = el.getBoundingClientRect();
          const init = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, buttons: 1 };
          el.dispatchEvent(new PointerEvent('pointerdown', init)); el.dispatchEvent(new MouseEvent('mousedown', init));
          el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 })); el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
          await new Promise(r2 => setTimeout(r2, 700));
        }
        return document.querySelectorAll('.elabftw-spreadsheet-editor-overlay.elabftw-spreadsheet-preview').length`);
      if (left === 0) break;
    }
    await sleep(1500);
    const sheets = await c.js(`return [...document.querySelectorAll('.elabftw-spreadsheet-editor-overlay')].filter(o => !o.classList.contains('elabftw-spreadsheet-preview') && o.querySelector('.jss_worksheet td[data-x]')).length`);
    console.log(`live (editable) grids on the page: ${sheets} of 5 (the editor keeps the sheets far from the viewport as previews)`);
    check('at least one sheet is a live grid', sheets >= 1, `${sheets} live overlays`);
    const intervals = await c.js('return window.__intervals50');
    console.log(`50 ms intervals created so far: ${intervals}`);
    const rate = async (label, ms = 5000) => {
      await c.js('window.__ticks50 = 0; return 1');
      await sleep(ms);
      const n = await c.js('return window.__ticks50');
      console.log(`wakeups/s ${label}: ${(n / (ms / 1000)).toFixed(1)} (${n} callbacks in ${ms / 1000} s)`);
      return n / (ms / 1000);
    };
    // nothing focused in a grid
    await c.js(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); return 1`);
    await sleep(500);
    await rate('with 5 live sheets, no grid focused');
    // focus the first grid (its keyboard sink, as a click on a cell does)
    await c.js(`const sink = document.querySelector('.elabftw-spreadsheet-editor-overlay:not(.elabftw-spreadsheet-preview) .jss_textarea'); sink.scrollIntoView({ block: 'center' }); sink.focus({ preventScroll: true }); return 1`);
    await sleep(800);
    const where = await c.js(`const a = document.activeElement; return a ? (a.tagName + '.' + (a.className || '') + ' in grid: ' + !!a.closest('.elabftw-spreadsheet-editor-overlay')) : 'none'`);
    console.log(`active element after focusing the grid: ${where}`);
    await rate('with focus in one grid');
    // focus every live grid in turn (some are read-only copies, the one that is being edited owns the poll): ticks per grid
    const perGrid = await c.js(`
      const out = [];
      const overlays = [...document.querySelectorAll('.elabftw-spreadsheet-editor-overlay')].filter(o => !o.classList.contains('elabftw-spreadsheet-preview'));
      for (const [i, o] of overlays.entries()) {
        const sink = o.querySelector('.jss_textarea');
        if (!sink) { out.push({ grid: i, sink: false }); continue; }
        sink.focus({ preventScroll: true });
        await new Promise(r => setTimeout(r, 300));
        window.__ticks50 = 0;
        await new Promise(r => setTimeout(r, 1500));
        out.push({ grid: i, focused: document.activeElement === sink, ticksPerSecond: window.__ticks50 / 1.5 });
      }
      return JSON.stringify(out)`);
    console.log(`focus each live grid in turn: ${perGrid}`);
    // click out of the grids
    await c.js(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const t = document.querySelector('h1, #documentTitle, .page-title') || document.body; t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.body.focus(); return 1`);
    await sleep(800);
    await rate('after leaving the grids again');
    await c.js(`await fetch('/api/v2/experiments/${id}', { method: 'DELETE', credentials: 'same-origin' }); return 1`).catch(() => 0);
  } finally {
    c.close();
  }
  const failed = results.filter(r => !r).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(2); });
