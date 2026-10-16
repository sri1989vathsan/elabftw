/**
 * Local test proxy: plain http://localhost:8973 in front of the dev container's self-signed
 * https://localhost:3150, because the Claude browser pane will not open the container's own https.
 *
 *     node tests/manual/dev-proxy.js
 *
 * - /__tests/<file> serves the top-level files of tests/manual (screenshots for the guide, scripts).
 * - Everything else goes to the container; cookies lose "Secure" so login works over http, absolute
 *   links to the container are rewritten to this address, and /assets are never cached.
 * Needs to be started again after a reboot.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LISTEN = Number(process.env.PROXY_PORT || 8973);
const TARGET_PORT = Number(process.env.TARGET_PORT || 3150);
const FROM = `https://localhost:${TARGET_PORT}`;
const TO = `http://localhost:${LISTEN}`;
const TESTS_DIR = __dirname;
// Optional: ASSETS_DIR=/some/folder serves /assets/* from there when the file exists (e.g. an older build's
// scripts and styles, to compare it with the current one on the same page and server). Start a second copy of
// this proxy on another port for that (PROXY_PORT=8974), leaving the normal one untouched.
const ASSETS_DIR = process.env.ASSETS_DIR ? path.resolve(process.env.ASSETS_DIR) : '';

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.md': 'text/plain', '.json': 'application/json' };

http.createServer((req, res) => {
  if (req.url.startsWith('/__tests/')) {
    const file = path.join(TESTS_DIR, path.basename(decodeURIComponent(req.url.slice('/__tests/'.length).split('?')[0])));
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (ASSETS_DIR && req.url.startsWith('/assets/')) {
    const file = path.resolve(ASSETS_DIR, decodeURIComponent(req.url.slice('/assets/'.length).split('?')[0]));
    if (file.startsWith(ASSETS_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || (file.endsWith('.css') ? 'text/css' : 'application/octet-stream'), 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  const headers = { ...req.headers, host: `localhost:${TARGET_PORT}`, 'accept-encoding': 'identity' };
  if (headers.origin) headers.origin = headers.origin.replace(TO, FROM);
  if (headers.referer) headers.referer = headers.referer.replace(TO, FROM);
  const upstream = https.request(
    { host: '127.0.0.1', port: TARGET_PORT, method: req.method, path: req.url, headers, rejectUnauthorized: false },
    response => {
      const out = { ...response.headers };
      if (out.location) out.location = out.location.replace(FROM, TO);
      if (out['set-cookie']) {
        out['set-cookie'] = out['set-cookie'].map(cookie => cookie.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax'));
      }
      if (req.url.startsWith('/assets/')) { delete out.etag; out['cache-control'] = 'no-store'; }
      const type = String(out['content-type'] || '');
      if (/text\/html|javascript|json|css/.test(type)) {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').split(FROM).join(TO);
          out['content-length'] = Buffer.byteLength(body);
          res.writeHead(response.statusCode, out);
          res.end(body);
        });
      } else {
        res.writeHead(response.statusCode, out);
        response.pipe(res);
      }
    },
  );
  upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
  req.pipe(upstream);
}).listen(LISTEN, '127.0.0.1', () => console.log(`proxy http://localhost:${LISTEN} -> ${FROM}`));
