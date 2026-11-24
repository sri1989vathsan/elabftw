#!/usr/bin/env node
/**
 * Wheel over any popup must not scroll the page behind it (src/ts/popup-wheel-lock.ts). Headless Chrome, real wheel events
 * (DevTools Input.dispatchMouseEvent mouseWheel):
 *
 *   node tests/manual/popup-wheel-check.js http://localhost:8973 EMAIL PASSWORD [screenshot.png]
 *
 * Makes two throw-away entries (long text + a well plate + a plain spreadsheet; long text) and deletes them at the end. For each popup the page is
 * scrolled to the middle, then the wheel goes down and up over the popup (also after the popup reached its end, and sideways):
 * window.scrollY must not change. With the pointer outside the popup (dropdown, side panel) or with no popup open, the page scrolls.
 * Popups: Bootstrap modal without overflow, modal with overflow (at its end), a nested scroller in a modal, spreadsheet popup,
 * well plate popup, Tools dropdown, side panel. SWL_BASELINE=1 drops the guard and the CSS (negative control: expect FAILs).
 * EMAIL/PASSWORD: see tests/manual/TEST-ACCOUNTS.md.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [base0, email, password, shot] = process.argv.slice(2);
if (!base0 || !email || !password) { console.error('usage: popup-wheel-check.js BASEURL EMAIL PASSWORD [screenshot.png]'); process.exit(2); }
const base = base0.replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1400, H = 800;

async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwl-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--ignore-certificate-errors', `--window-size=${W},${H}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, d => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return {
    send,
    async nav(url) { await send('Page.navigate', { url }); await sleep(1500); for (let i = 0; i < 40; i++) { if (await this.js('return document.readyState').catch(() => '') === 'complete') break; await sleep(250); } },
    async js(code) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'js error');
      return r.result.value;
    },
    async wheel(x, y, dx, dy) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
      await sleep(120);
    },
    async close() { try { ws.close(); } catch { /* */ } proc.kill(); await sleep(1000); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

(async () => {
  const c = await startChrome();
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`); };
  const ids = [];
  const hdr = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  const waitEditor = async () => { for (let i = 0; i < 60; i++) { await sleep(1000); if (await c.js('return !!(window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized)').catch(() => false)) return true; } return false; };
  const y = () => c.js('return scrollY');
  const mid = () => c.js(`const t = Math.round((document.documentElement.scrollHeight - innerHeight) / 2); scrollTo(0, t); await new Promise(r => setTimeout(r, 700)); return scrollY`);
  const point = sel => c.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height / 2, 200))]`);
  // page in the middle, wheel down x6 then up x6 (and sideways) over a point: scrollY must not change
  const stays = async (name, pt, keep = false) => { // keep: the page is already where it should be (a menu that closes when the page scrolls)
    const before = keep ? await y() : await mid(); const seen = [];
    if (typeof pt === 'string') pt = await point(pt);
    for (const [dx, dy] of [[0, 400], [0, 400], [0, 400], [0, 400], [0, 400], [0, -400], [0, -400], [0, -400], [300, 0], [-300, 0]]) { await c.wheel(pt[0], pt[1], dx, dy); seen.push(await y()); }
    check(name, before > 0 && seen.every(v => v === before), { before, seen });
  };
  const scrolls = async (name, pt, keep = false) => { const before = keep ? await y() : await mid(); await c.wheel(pt[0], pt[1], 0, 200); const after = await y(); check(name, after > before, { before, after }); };
  try {
    await c.nav(`${base}/login.php`);
    await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
      const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
    await sleep(3500);
    const make = title => c.js(`const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: ${JSON.stringify(title)} }) }); return Number(r.headers.get('Location').split('/').pop())`);
    const longText = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(8)}</p>`).join('');
    const plateId = await make('popup wheel plate'); ids.push(plateId);
    await c.nav(`${base}/experiments.php?mode=edit&id=${plateId}`);
    if (!await waitEditor()) throw new Error('editor did not start');
    await c.js(`
      const ed = tinymce.activeEditor;
      const grid = (r, k) => Array.from({ length: r }, () => Array.from({ length: k }, () => ''));
      ed.setContent(${JSON.stringify(longText)});
      ed.execCommand('elabftwInsertSpreadsheetData', false, { data: grid(8, 12), cols: 12, rows: 8, kind: 'well-plate', plateSize: 96, caption: '96-well plate' });
      ed.execCommand('elabftwInsertSpreadsheetData', false, { data: grid(6, 5), cols: 5, rows: 6, caption: 'plain sheet' });
      await new Promise(r => setTimeout(r, 1200));
      await fetch('/api/v2/experiments/${plateId}', { method: 'PATCH', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ body: ed.getContent() }) });
      return 1`);

    // opens "Edit selected spreadsheet" for the table whose caption matches
    const openSheetPopup = async (which) => {
      await c.nav(`${base}/experiments.php?mode=edit&id=${plateId}`);
      await waitEditor(); await sleep(1500);
      await c.wheel(700, 400, 0, 1); // the edit page keeps itself at the top until the user acts (tinymce.ts): act once, so the scroll position set below stays
      await c.js(`
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const ed = tinymce.activeEditor;
        const ts = [...ed.getBody().querySelectorAll('table.elabftw-spreadsheet')];
        const t = ts.find(x => x.outerHTML.includes(${JSON.stringify(which === 'plate' ? '96-well plate' : 'plain sheet')})) || ts[0];
        ed.selection.select(t.querySelector('td, th') || t, true); ed.nodeChanged(); await wait(800);
        const click = async (sel, re) => { const el = [...document.querySelectorAll(sel)].find(e => re.test((e.getAttribute('aria-label') || e.textContent || '').trim())); if (el) el.click(); await wait(900); };
        await click('.tox-tbtn', /Spreadsheet tools/); await click('.tox-collection__item', /^Edit selected spreadsheet/);
        await wait(1500); return 1`);
    };
    const baseline = async () => { // negative control
      if (process.env.SWL_BASELINE) await c.js(`window.addEventListener('wheel', e => e.stopImmediatePropagation(), true); const s = document.createElement('style'); s.textContent = '* { overscroll-behavior: auto !important }'; document.head.appendChild(s); return 0`);
    };

    // spreadsheet popup and well plate popup (the page is the editor page; the popup is full-window)
    for (const [name, which, sel] of [['spreadsheet popup', 'sheet', '.inline-spreadsheet-dialog:not(.wp-dialog)'], ['well plate popup', 'plate', '.wp-dialog']]) {
      await openSheetPopup(which); await baseline();
      const pt = await point(sel);
      if (!pt) { check(`${name} opens`, false, sel); continue; }
      await stays(`${name}: wheel over it does not scroll the page`, pt);
      const ov = await point('.inline-spreadsheet-overlay');
      const edge = await c.js(`const r = document.querySelector('.inline-spreadsheet-overlay').getBoundingClientRect(); return [Math.round(r.left + 6), Math.round(r.top + 6)]`);
      await stays(`${name}: wheel over its backdrop does not scroll the page`, edge);
      if (name === 'well plate popup' && shot) { const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot, Buffer.from(s.data, 'base64')); }
      void ov;
      await c.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 0`);
    }

    // a long view page for modal, dropdown and side panel
    const longId = await make('popup wheel long'); ids.push(longId);
    await c.js(`await fetch('/api/v2/experiments/${longId}', { method: 'PATCH', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ body: ${JSON.stringify(longText + '<h2>End</h2>')} }) }); return 1`);
    await c.nav(`${base}/experiments.php?mode=view&id=${longId}`); await sleep(1500); await baseline();
    await scrolls('no popup open: wheel over the text scrolls the page', [900, 400]);

    // Bootstrap modals (real markup, shown with Bootstrap's own plugin)
    const showModal = (inner) => c.js(`
      document.getElementById('pwl-modal')?.remove();
      const m = document.createElement('div'); m.className = 'modal fade'; m.id = 'pwl-modal'; m.tabIndex = -1;
      m.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">t</h5></div><div class="modal-body">' + ${JSON.stringify(inner)} + '</div></div></div>';
      document.body.appendChild(m); $(m).modal('show'); await new Promise(r => setTimeout(r, 800)); return 1`);
    await showModal('<p>Short modal, nothing to scroll.</p>');
    await stays('modal without overflow: wheel over the dialog does not scroll the page', await point('#pwl-modal .modal-body'));
    await stays('modal without overflow: wheel over the dimmed area does not scroll the page', [40, 40]);
    await c.js(`$('#pwl-modal').modal('hide'); await new Promise(r => setTimeout(r, 600)); return 1`);
    await showModal('<div style="height:2500px">tall</div>');
    const pt = [700, 400];
    await stays('modal with overflow: wheel does not scroll the page behind it', pt);
    for (let i = 0; i < 12; i++) await c.wheel(pt[0], pt[1], 0, 800);
    const atEnd = await c.js(`const m = document.getElementById('pwl-modal'); return m.scrollTop + m.clientHeight >= m.scrollHeight - 2`);
    check('modal with overflow: it scrolled itself to its end', atEnd, null);
    await stays('modal with overflow: at its end, wheel still does not scroll the page', pt);
    await c.js(`$('#pwl-modal').modal('hide'); await new Promise(r => setTimeout(r, 600)); return 1`);
    await showModal('<div id="pwl-nest" style="height:120px;overflow:auto"><div style="height:900px">nested</div></div>');
    const np = await point('#pwl-nest'); await c.wheel(np[0], np[1], 0, 100);
    check('a nested scroller inside a modal keeps scrolling', await c.js(`return document.getElementById('pwl-nest').scrollTop`) > 0, null);
    await c.js(`$('#pwl-modal').modal('hide'); await new Promise(r => setTimeout(r, 600)); document.getElementById('pwl-modal').remove(); return 1`);

    // Tools dropdown (page background stays scrollable with the pointer outside the menu)
    await mid(); await sleep(300); // the navbar is sticky: the menu opens at the top of the window
    // the Tools menu when the navbar shows it, else the first visible dropdown of the navbar (it may be folded into "More")
    const opened = await c.js(`const vis = e => e.getBoundingClientRect().width > 0;
      const toggles = [...document.querySelectorAll('nav [data-toggle="dropdown"]')].filter(vis);
      const t = toggles.find(e => e.id === 'navToolsDropdown') || toggles[0]; if (!t) return null;
      $(t).dropdown('toggle'); await new Promise(r => setTimeout(r, 500));
      const m = t.parentElement.querySelector('.dropdown-menu.show'); if (!m) return null;
      m.setAttribute('data-pwl-menu', t.id || 'x'); return t.id || 'x'`);
    check('a dropdown menu opens', !!opened, opened);
    if (opened) {
      const dp = await point('[data-pwl-menu]');
      const dpSel = '[data-pwl-menu]';
      await stays('dropdown menu: wheel over it does not scroll the page', dpSel, true);
      // pointer outside the menu: far from it, the page scrolls
      const out = dp[0] > 700 ? [200, 500] : [1000, 500];
      await scrolls('dropdown menu open, pointer outside it: the page scrolls', out, true);
      await c.js(`document.body.click(); return 1`);
    }

    // side panel
    await c.js(`document.getElementById('tocPanelOpener').click(); await new Promise(r => setTimeout(r, 1500)); return 1`);
    const sp = await point('#tocPanel');
    if (!sp) check('side panel opens', false, null);
    else {
      await stays('side panel: wheel over it does not scroll the page', [Math.min(sp[0], 200), 300]);
      await scrolls('side panel open, pointer over the text: the page scrolls', [1000, 400]);
    }
  } catch (e) {
    check('script ran without an exception', false, String(e && e.stack || e).replace(/\\n/g, ' '));
  } finally {
    try { for (const id of ids) await c.js(`await fetch('/api/v2/experiments/${id}', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); return 0`); } catch { /* best effort */ }
    await c.close();
  }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
