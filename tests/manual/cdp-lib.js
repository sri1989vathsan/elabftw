/**
 * Small headless-Chrome helper shared by the *-check.js scripts that log in and read pages (DevTools protocol, no packages).
 * startChrome() -> { send, nav, js, shot, login, close }. js(code) runs an async function body in the page and returns its value.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startChrome(W = 1400, H = 900) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-chrome-'));
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
  const c = {
    send,
    async nav(url) { await send('Page.navigate', { url }); await sleep(1500); for (let i = 0; i < 40; i++) { if (await c.js('return document.readyState').catch(() => '') === 'complete') break; await sleep(250); } },
    async js(code) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'js error');
      return r.result.value;
    },
    async shot(file) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(s.data, 'base64')); },
    async login(base, email, password) {
      await c.nav(`${base}/login.php`);
      await c.js(`document.getElementById('email').value = ${JSON.stringify(email)}; document.getElementById('password').value = ${JSON.stringify(password)};
        const b = [...document.querySelectorAll('button[type=submit]')].find(x => /login/i.test(x.textContent)); setTimeout(() => b.click(), 50); return 0`);
      await sleep(3500);
    },
    async close() { try { ws.close(); } catch { /* */ } proc.kill(); await sleep(1000); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return c;
}

module.exports = { startChrome, sleep };
