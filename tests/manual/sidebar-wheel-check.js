#!/usr/bin/env node
/**
 * Wheel over the sidebar must not scroll the page (sidebar-wheel-lock). Drives a real browser with real wheel events:
 *
 *   node tests/manual/sidebar-wheel-check.js chrome  http://localhost:8988 EMAIL PASSWORD
 *   node tests/manual/sidebar-wheel-check.js firefox http://localhost:8988 EMAIL PASSWORD
 *
 * Chrome: headless, DevTools Input.dispatchMouseEvent (mouseWheel). Firefox: headless, Marionette wheel actions.
 * Self-signed certificates are accepted. Makes two throw-away experiments (a long one with 60 headings, a short one with 2) and
 * deletes them at the end. Asserts, on the long entry's view page:
 *  (a) the wheel over the main text scrolls the page;
 *  (b) the wheel down/up over the rail and over the open Folders, Search and Contents panels (short and long content, also after the
 *      panel reached its end, also over the drag handle) never changes the page's scrollY;
 *  (c) a long panel scrolls itself, a nested scroller inside it keeps scrolling;
 *  (d) a sideways wheel over the panel does not scroll the page;
 *  (e) with the panel closed the page scrolls again; ctrl + wheel (zoom) is not cancelled.
 * Prints PASS/FAIL per check; exit code 1 on any failure. EMAIL/PASSWORD: see tests/manual/TEST-ACCOUNTS.md.
 */
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [browser = 'chrome', base = 'http://localhost:8988', email, password] = process.argv.slice(2);
if (!email || !password) { console.error('usage: sidebar-wheel-check.js chrome|firefox BASEURL EMAIL PASSWORD'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1400, H = 700;

// ---------- Chrome (DevTools protocol) ----------
async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swl-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--ignore-certificate-errors', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
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
    async nav(url) { await send('Page.navigate', { url }); await sleep(1500); for (let i = 0; i < 40; i++) { if (await this.js('document.readyState') === 'complete') break; await sleep(250); } },
    async js(code) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'js error');
      return r.result.value;
    },
    async wheel(x, y, dx, dy, ctrl = false) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers: ctrl ? 2 : 0 });
      await sleep(120);
    },
    async resize(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(300); },
    async close() { try { ws.close(); } catch { /* */ } proc.kill(); await sleep(1000); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------- Firefox (Marionette) ----------
async function startFirefox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swl-ff-'));
  const port = 2840 + Math.floor(Math.random() * 100);
  fs.writeFileSync(path.join(dir, 'user.js'), `user_pref("marionette.port", ${port});\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);\n`);
  const proc = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', ['--headless', '--marionette', '--profile', dir, '-no-remote'], { stdio: 'ignore' });
  let sock;
  for (let i = 0; i < 60 && !sock; i++) {
    await sleep(500);
    sock = await new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => res(s)); s.once('error', () => res(null)); });
  }
  let buf = Buffer.alloc(0); let id = 0; const pending = new Map(); let hello;
  const helloP = new Promise(r => { hello = r; });
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const c = buf.indexOf(':'); if (c < 0) return;
      const len = Number(buf.subarray(0, c).toString()); if (buf.length < c + 1 + len) return;
      const msg = JSON.parse(buf.subarray(c + 1, c + 1 + len).toString()); buf = buf.subarray(c + 1 + len);
      if (Array.isArray(msg)) { const p = pending.get(msg[1]); if (p) { pending.delete(msg[1]); p(msg); } } else hello();
    }
  });
  await helloP;
  const send = (name, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, m => m[2] ? rej(new Error(JSON.stringify(m[2]))) : res(m[3]));
    const body = JSON.stringify([0, i, name, params]); sock.write(`${Buffer.byteLength(body)}:${body}`);
  });
  await send('WebDriver:NewSession', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const setViewport = async (w, h) => {
    await send('WebDriver:SetWindowRect', { width: w + 20, height: h + 120 });
    for (let i = 0; i < 10; i++) { // fit the inner size to what was asked
      const s = await send('WebDriver:ExecuteScript', { script: 'return [innerWidth, innerHeight, outerWidth, outerHeight]', args: [] });
      const [iw, ih, ow, oh] = s.value;
      if (iw === w && ih === h) return;
      await send('WebDriver:SetWindowRect', { width: ow + (w - iw), height: oh + (h - ih) });
    }
  };
  await send('WebDriver:Navigate', { url: `${base}/login.php` }); // scripts do not run in the start page
  await sleep(1500);
  await setViewport(W, H);
  return {
    async nav(url) { await send('WebDriver:Navigate', { url }); await sleep(1500); for (let i = 0; i < 40; i++) { if (await this.js('return document.readyState') === 'complete') break; await sleep(250); } },
    async js(code) {
      const r = await send('WebDriver:ExecuteAsyncScript', { script: `const done = arguments[arguments.length-1]; (async()=>{${code}})().then(v => done(v === undefined ? null : v), e => done({__error: String(e)}));`, args: [], newSandbox: false });
      if (r.value && r.value.__error) throw new Error(r.value.__error);
      return r.value;
    },
    async wheel(x, y, dx, dy, ctrl = false) {
      const actions = [];
      if (ctrl) actions.push({ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: '' }] });
      actions.push({ type: 'wheel', id: 'w', actions: [{ type: 'scroll', x: Math.round(x), y: Math.round(y), deltaX: dx, deltaY: dy, duration: 0, origin: 'viewport' }] });
      await send('WebDriver:PerformActions', { actions });
      await send('WebDriver:ReleaseActions');
      await sleep(250);
    },
    resize: async (w, h) => { await setViewport(w, h); await sleep(300); },
    async close() { try { sock.destroy(); } catch { /* */ } proc.kill(); await sleep(1500); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------- the checks ----------
(async () => {
  const b = browser === 'firefox' ? await startFirefox() : await startChrome();
  if (process.env.SWL_BASELINE) { // negative control: behave like the page before the fix (no overscroll-behavior, no wheel guard); expect FAILs. SWL_BASELINE=css: CSS only, no wheel guard
    const nav = b.nav.bind(b);
    b.nav = async url => {
      await nav(url);
      await b.js(`window.addEventListener('wheel', e => e.stopImmediatePropagation(), true);
        if (${JSON.stringify(process.env.SWL_BASELINE)} !== 'css') { // SWL_BASELINE=css keeps the CSS: shows what the wheel guard adds
          const st = document.createElement('style'); st.textContent = '.side-panel, #sidepanel-buttons, .side-panel-resizer { overscroll-behavior: auto !important }'; document.head.appendChild(st);
        }
        return 0`);
    };
  }
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`); };
  const ids = [];
  try {
    await b.nav(`${base}/login.php`);
    await b.js(`
      const f = document.getElementById('email'); f.value = ${JSON.stringify(email)};
      const p = document.getElementById('password'); p.value = ${JSON.stringify(password)};
      const btn = [...document.querySelectorAll('button[type=submit], input[type=submit]')].find(x => /login|log in/i.test(x.textContent + x.value));
      setTimeout(() => btn.click(), 50); // the page unloads: answer first
      return 0;`);
    await sleep(3000);
    if (process.env.SWL_DEBUG) console.log('after login:', await b.js('return location.href + " " + document.title'));
    // two throw-away experiments
    const make = async (title, body) => b.js(`
      const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
      const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify({ title: ${JSON.stringify(title)} }) });
      const id = Number(r.headers.get('Location').split('/').pop());
      await fetch('/api/v2/experiments/' + id, { method: 'PATCH', credentials: 'same-origin', headers: h, body: JSON.stringify({ body: ${JSON.stringify(body)} }) });
      return id;`);
    let longBody = '';
    for (let i = 1; i <= 60; i++) longBody += `<h2>Heading ${i}</h2><p>${'Lorem ipsum dolor sit amet. '.repeat(12)}</p>`;
    const longId = await make('wheel check long', longBody);
    const shortId = await make('wheel check short', '<h2>Only</h2><p>Short.</p>');
    ids.push(longId, shortId);

    const state = () => b.js(`return { y: scrollY, h: document.documentElement.scrollHeight, ih: innerHeight }`);
    const panelState = id => b.js(`const p = document.getElementById(${JSON.stringify(id)}); return p ? { hidden: p.hidden, st: p.scrollTop, sh: p.scrollHeight, ch: p.clientHeight, top: p.getBoundingClientRect().top } : null`);
    const resetPage = () => b.js(`scrollTo(0, 0); return 0`);
    const openPanel = async id => { // closes any open panel, then opens this one
      await b.js(`document.querySelectorAll('.side-panel:not([hidden])').forEach(p => document.getElementById(p.id + 'Opener')?.click()); return 0`);
      await sleep(300);
      await b.js(`document.getElementById(${JSON.stringify(id)} + 'Opener').click(); return 0`);
      await sleep(1500);
    };
    // a point inside an element's box, by selector
    const point = sel => b.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 300)]`);

    // over a point, wheel down several times then up several times: the page must stay where it is
    const pageStays = async (name, pt, { horizontal = false } = {}) => {
      await resetPage(); const before = (await state()).y;
      const seen = [];
      for (let i = 0; i < 6; i++) { await b.wheel(pt[0], pt[1], horizontal ? 300 : 0, horizontal ? 0 : 400); seen.push((await state()).y); }
      for (let i = 0; i < 6; i++) { await b.wheel(pt[0], pt[1], horizontal ? -300 : 0, horizontal ? 0 : -400); seen.push((await state()).y); }
      check(name, seen.every(y => y === before), { before, seen });
    };

    await b.nav(`${base}/experiments.php?mode=view&id=${longId}`);
    await sleep(1500);
    const st0 = await state();
    check('the test entry is long enough', st0.h > st0.ih * 3, st0);

    // (a) main text scrolls the page
    await resetPage();
    await b.wheel(900, 400, 0, 400);
    const afterMain = await state();
    check('(a) wheel over the main text scrolls the page', afterMain.y > 0, afterMain);

    // (e) first with no panel open: page scrolls, and the rail still does not pass the wheel on
    await b.js(`document.querySelectorAll('.side-panel:not([hidden])').forEach(p => document.getElementById(p.id + 'Opener')?.click()); return 0`);
    await sleep(500);
    await resetPage();
    await b.wheel(900, 400, 0, 400);
    check('(e) panel closed: wheel over the main text scrolls the page', (await state()).y > 0, await state());
    const railPt = await point('#sidepanel-buttons .sidepanel-btn');
    check('the rail exists', !!railPt, railPt);
    if (railPt) {
      await pageStays('(b) rail, no panel open: wheel does not scroll the page', railPt);
      const gap = await b.js(`const bs = [...document.querySelectorAll('#sidepanel-buttons .sidepanel-btn')]; if (bs.length < 2) return null; const a = bs[0].getBoundingClientRect(), c = bs[1].getBoundingClientRect(); return [a.left + 3, (a.bottom + c.top) / 2]`);
      if (gap) await pageStays('(b) rail, between two buttons: wheel does not scroll the page', gap);
      await pageStays('(d) rail: sideways wheel does not scroll the page', railPt, { horizontal: true });
    }

    // ctrl + wheel is zoom: it must not be cancelled (defaultPrevented stays false)
    await b.js(`window.__ctrlPrevented = null; document.addEventListener('wheel', e => { if (e.ctrlKey) setTimeout(() => { window.__ctrlPrevented = e.defaultPrevented; }, 0); }, { passive: true }); return 0`);
    if (railPt) {
      await b.wheel(railPt[0], railPt[1], 0, 100, true);
      const prevented = await b.js('return window.__ctrlPrevented');
      check('ctrl + wheel over the rail is left alone (zoom)', prevented === false || prevented === null, prevented);
    }

    // the panels
    const panels = [['Folders', 'foldersPanel', longId], ['Search', 'favoritesPanel', longId], ['Contents (long)', 'tocPanel', longId], ['Contents (short)', 'tocPanel', shortId]];
    for (const [name, id, entry] of panels) {
      if (entry !== longId || (name === 'Contents (short)')) {
        await b.nav(`${base}/experiments.php?mode=view&id=${entry}`); await sleep(1500);
      } else if (!(await b.js(`return location.search.includes('id=${longId}')`))) {
        await b.nav(`${base}/experiments.php?mode=view&id=${longId}`); await sleep(1500);
      }
      const exists = await b.js(`return !!document.getElementById(${JSON.stringify(id + 'Opener')})`);
      if (!exists) { check(`${name}: panel exists on this page`, false, id); continue; }
      await openPanel(id);
      const ps = await panelState(id);
      check(`${name}: panel opens`, ps && !ps.hidden, ps);
      if (!ps || ps.hidden) continue;
      // the page may be shorter than the viewport for the short entry: there is nothing to scroll, so scroll position can not prove
      // anything; the long entry is used for the page, the panel's content is what is short or long
      const pt = await point(`#${id}`);
      const inside = [Math.min(pt[0], 200), 300];
      await pageStays(`(b) ${name}: wheel does not scroll the page`, inside);
      // keep going until the panel reached its end, then again
      for (let i = 0; i < 40; i++) await b.wheel(inside[0], inside[1], 0, 600);
      await pageStays(`(b) ${name}: ... also after the panel reached its end`, inside);
      await pageStays(`(d) ${name}: sideways wheel does not scroll the page`, inside, { horizontal: true });
      const handle = await point('.side-panel:not([hidden]) .side-panel-resizer');
      if (handle) await pageStays(`(b) ${name}: wheel over the drag handle does not scroll the page`, handle);
      // the scroll bar's own column and the panel's bottom edge
      await pageStays(`(b) ${name}: wheel at the panel's bottom edge does not scroll the page`, [inside[0], H - 4]);
      // (c) a panel with more content than room scrolls itself (checked in a small window so that every panel is long)
      await b.resize(W, 260);
      await sleep(400);
      const p2 = await panelState(id);
      if (p2 && p2.sh > p2.ch + 5) {
        await b.js(`document.getElementById(${JSON.stringify(id)}).scrollTop = 0; return 0`);
        await b.wheel(inside[0], 120, 0, 150);
        const p3 = await panelState(id);
        check(`(c) ${name}: a panel with more content than room scrolls itself`, p3.st > 0, { p2, p3 });
        await pageStays(`(b) ${name}: small window, wheel does not scroll the page (also at the end)`, [inside[0], 120]);
      } else {
        check(`(c) ${name}: panel content does not exceed a 260 px window (nothing to scroll)`, true);
      }
      await b.resize(W, H);
    }

    // nested scroller: the Search panel's result list, or any scrollable element inside an open panel, keeps scrolling
    await b.nav(`${base}/experiments.php?mode=view&id=${longId}`); await sleep(1500);
    await openPanel('tocPanel');
    const nested = await b.js(`
      const panel = document.getElementById('tocPanel');
      const box = document.createElement('div'); box.id = 'swl-nested';
      box.style.cssText = 'height:80px;overflow:auto;margin:4px 0';
      box.innerHTML = '<div style="height:600px">nested content</div>';
      panel.querySelector('.p-3, div').appendChild(box);
      box.scrollIntoView({ block: 'center' });
      const r = box.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`);
    await resetPage();
    await b.wheel(nested[0], nested[1], 0, 100);
    const nst = await b.js(`return document.getElementById('swl-nested').scrollTop`);
    check('(c) a nested scroller inside the panel keeps scrolling', nst > 0, nst);
    await b.js(`document.getElementById('swl-nested').remove(); return 0`);

    // (e) panel closed again: page scrolls
    await b.js(`document.querySelectorAll('.side-panel:not([hidden])').forEach(p => document.getElementById(p.id + 'Opener')?.click()); return 0`);
    await sleep(500);
    await resetPage();
    await b.wheel(900, 400, 0, 400);
    check('(e) panel closed again: wheel over the main text scrolls the page', (await state()).y > 0, await state());

    // the edit page (TinyMCE) and the dashboard: same lock
    for (const [label, url] of [['edit page', `${base}/experiments.php?mode=edit&id=${longId}`], ['dashboard', `${base}/dashboard.php`]]) {
      await b.nav(url); await sleep(3500);
      await openPanel('tocPanel').catch(() => {});
      const open = await b.js(`return !!document.querySelector('.side-panel:not([hidden])')`);
      if (!open) { await openPanel('foldersPanel').catch(() => {}); }
      const pt = await point('.side-panel:not([hidden])');
      const sh = await state();
      if (!pt) { check(`${label}: a panel opens`, false, null); continue; }
      if (sh.h <= sh.ih + 50) { check(`${label}: page is not scrollable (skipped)`, true); continue; }
      await pageStays(`(b) ${label}: wheel over the open panel does not scroll the page`, [Math.min(pt[0], 200), 300]);
    }
  } catch (e) {
    check("script ran without an exception", false, String(e && e.stack || e).replace(/\\n/g, " "));
  } finally {
    try {
      for (const id of ids) await b.js(`await fetch('/api/v2/experiments/${id}', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); return 0`);
    } catch { /* cleanup is best effort */ }
    await b.close();
  }
  const failed = results.filter(x => !x).length;
  console.log(`\n${browser}: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
