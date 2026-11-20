#!/usr/bin/env node
/**
 * What the front-end costs per page (bundle-split): bytes, parse/compile time, time to interactive and heap, in headless Chrome.
 *
 *   node tests/manual/bundle-split-perf.js BASEURL EMAIL PASSWORD [label] [seed]
 *
 * `seed` first (once per database): makes an entry with 5 spreadsheets and prints its id (kept: both builds are measured on the same entry):
 *   node tests/manual/bundle-split-perf.js BASEURL EMAIL PASSWORD seed
 *
 * Pages: dashboard, the experiments list, the 5-sheet entry in view mode, the same in edit mode, the admin page. For each page, 5 loads with
 * the cache off ("cold": bytes are the transfer size over the wire, br or gzip as the server sends it, and the raw decoded size) and 5 with the
 * cache on ("warm"); the median of each number is printed as JSON lines plus a table. Run at CPU throttling 1 and 4 (a slow laptop).
 * Numbers per load: js/css request list, raw and transfer bytes of scripts and styles, V8 compile time, script time, main-thread tasks,
 * total blocking time, time to interactive (end of the last long task, with 1.5 s of quiet after it), heap after a forced GC.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [base, email, password, label = 'run', mode = 'measure'] = process.argv.slice(2);
if (!base || !email || !password) { console.error('usage: bundle-split-perf.js BASEURL EMAIL PASSWORD [label] [seed]'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1400,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up */ } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) listeners.forEach(l => l(d));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, d => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Network.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const js = async code => {
    const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'js error');
    return r.result.value;
  };
  return {
    send, js, on: l => listeners.push(l), off: l => listeners.splice(listeners.indexOf(l), 1),
    close() { try { ws.close(); } catch { /* */ } proc.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1500); },
  };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function login(c) {
  await c.send('Page.navigate', { url: `${base}/login.php` }); await sleep(2500);
  await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
    const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
  await sleep(3500);
}

async function seed(c) {
  const h = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  const id = await c.js(`const h = ${h}; const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify({ title: 'perf: five spreadsheets' }) }); return Number(r.headers.get('Location').split('/').pop())`);
  await c.send('Page.navigate', { url: `${base}/experiments.php?mode=edit&id=${id}` });
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await c.js(`return !!(window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized)`).catch(() => false)) break; }
  await sleep(1500);
  const n = await c.js(`
    const ed = tinymce.activeEditor;
    for (let k = 0; k < 5; k++) {
      const rows = 12, cols = 8;
      const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, cc) => r === 0 ? 'Col ' + (cc + 1) : String((r * 7 + cc * 3 + k) % 100)));
      ed.execCommand('elabftwInsertSpreadsheetData', false, { data, cols, rows, kind: 'standard', caption: 'Sheet ' + (k + 1) });
      await new Promise(r => setTimeout(r, 700));
      ed.insertContent('<p>Text after sheet ' + (k + 1) + '. ' + 'Lorem ipsum dolor sit amet. '.repeat(10) + '</p>');
    }
    const body = ed.getContent();
    const r = await fetch('/api/v2/experiments/${id}', { method: 'PATCH', credentials: 'same-origin', headers: ${h}, body: JSON.stringify({ body }) });
    return (body.match(/class="elabftw-spreadsheet"/g) || []).length + ' sheets, PATCH ' + r.status;`);
  console.log(`entry ${id}: ${n}`);
  return id;
}

async function measureOne(c, url, { cache, throttle }) {
  await c.send('Network.setCacheDisabled', { cacheDisabled: !cache });
  await c.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  // a blank page first so each load starts from the same place (and a warm load keeps the HTTP cache)
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  const reqs = new Map();
  const onEvent = d => {
    const p = d.params;
    if (d.method === 'Network.responseReceived' && ['Script', 'Stylesheet'].includes(p.type)) reqs.set(p.requestId, { url: p.response.url, type: p.type, fromCache: p.response.fromDiskCache || p.response.fromServiceWorker, enc: p.response.headers['content-encoding'] || p.response.headers['Content-Encoding'] || '', raw: 0, wire: 0 });
    if (d.method === 'Network.dataReceived' && reqs.has(p.requestId)) reqs.get(p.requestId).raw += p.dataLength;
    if (d.method === 'Network.loadingFinished' && reqs.has(p.requestId)) reqs.get(p.requestId).wire = p.encodedDataLength;
  };
  c.on(onEvent);
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) {}` }).then(r => { c.__scriptId = r.identifier; });
  await c.send('Page.navigate', { url });
  // wait for load, then for 1.5 s without a long task (at most 25 s)
  let tti = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await sleep(500);
    const st = await c.js(`const n = performance.getEntriesByType('navigation')[0]; return { loaded: n && n.loadEventEnd > 0, lt: window.__lt || [], now: performance.now() }`).catch(() => null);
    if (!st || !st.loaded) continue;
    const lastEnd = st.lt.length ? Math.max(...st.lt.map(([s, d]) => s + d)) : 0;
    if (st.now - lastEnd > 1500) { tti = Math.max(lastEnd, 0); break; }
  }
  await sleep(500);
  c.off(onEvent);
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: c.__scriptId });
  const nav = await c.js(`const n = performance.getEntriesByType('navigation')[0]; const lt = window.__lt || []; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, longTasks: lt.length, tbt: lt.reduce((a, [, d]) => a + Math.max(0, d - 50), 0), ltEnd: lt.length ? Math.max(...lt.map(([s, d]) => s + d)) : 0 }`);
  await c.send('HeapProfiler.collectGarbage').catch(() => {});
  const m = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const list = [...reqs.values()].filter(r => r.url.startsWith(base));
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const js = list.filter(r => r.type === 'Script'), css = list.filter(r => r.type === 'Stylesheet');
  return {
    jsFiles: js.length, jsRaw: sum(js, 'raw'), jsWire: sum(js, 'wire'), cssFiles: css.length, cssRaw: sum(css, 'raw'), cssWire: sum(css, 'wire'),
    names: js.map(r => r.url.split('/').pop().split('?')[0]).sort().join(' '),
    dcl: nav.dcl, load: nav.load, tti: tti ?? nav.ltEnd, tbt: nav.tbt, longTasks: nav.longTasks,
    compileMs: (m.V8CompileDuration ?? 0) * 1000, scriptMs: m.ScriptDuration * 1000, taskMs: m.TaskDuration * 1000, heapMB: m.JSHeapUsedSize / 1048576,
  };
}

(async () => {
  const c = await startChrome();
  try {
    await login(c);
    if (mode === 'seed') { await seed(c); return; }
    // find the seeded entry: the newest "perf: five spreadsheets"
    const found = await c.js(`const r = await fetch('/api/v2/experiments?q=' + encodeURIComponent('perf: five spreadsheets') + '&limit=1', { credentials: 'same-origin' }); const j = await r.json(); return j[0] ? j[0].id : 0`);
    if (!found) throw new Error('no seeded entry: run with "seed" first');
    const pages = [
      ['dashboard', `${base}/dashboard.php`],
      ['list', `${base}/experiments.php`],
      ['view-5-sheets', `${base}/experiments.php?mode=view&id=${found}`],
      ['edit-5-sheets', `${base}/experiments.php?mode=edit&id=${found}`],
      ['admin', `${base}/admin.php`],
    ];
    const out = [];
    for (const throttle of [1, 4]) {
      for (const [name, url] of pages) {
        for (const cache of [false, true]) {
          const runs = [];
          if (cache) { await measureOne(c, url, { cache: true, throttle }); } // fills the cache
          for (let i = 0; i < 5; i++) runs.push(await measureOne(c, url, { cache, throttle }));
          const row = { label, page: name, cpu: `${throttle}x`, cache: cache ? 'warm' : 'cold', names: runs[0].names };
          for (const k of ['jsFiles', 'jsRaw', 'jsWire', 'cssFiles', 'cssRaw', 'cssWire', 'dcl', 'load', 'tti', 'tbt', 'longTasks', 'compileMs', 'scriptMs', 'taskMs', 'heapMB']) row[k] = Math.round(median(runs.map(r => r[k])) * 10) / 10;
          out.push(row);
          console.log(JSON.stringify(row));
        }
      }
    }
    const file = path.join(process.env.PERF_OUT || os.tmpdir(), `perf-${label}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 1));
    console.log('written', file);
  } finally {
    c.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
