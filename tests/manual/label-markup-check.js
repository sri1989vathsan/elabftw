/**
 * Label markup (web/label-markup.js, web/label-markup.php): run `node tests/manual/label-markup-check.js` for the JS parser, and
 * `php tests/manual/label-markup-check.php` (any PHP 8; or docker run --rm --entrypoint php -v "$PWD":/w:ro <the elabimg image> /w/tests/manual/label-markup-check.php)
 * for the PHP one: both read label-markup-cases.json and must give the same pieces for every case.
 * In the browser, `await labelMarkupCheck()` (console, any page) also checks the dialog against the server: see the bottom of this file.
 */
'use strict';
function runCases(parse, cases) {
  const results = [];
  const flags = p => (p.bold ? 'b' : '') + (p.italic ? 'i' : '');
  for (const c of cases) {
    const got = parse(c.in);
    const pieces = got.pieces.map(p => [p.text, flags(p), p.scale]);
    const ok = JSON.stringify(pieces) === JSON.stringify(c.pieces) && got.marked === c.marked;
    results.push({ name: c.name, ok, detail: ok ? undefined : JSON.stringify({ got: pieces, marked: got.marked }) });
  }
  return results;
}
if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { parse } = require(path.join(__dirname, '../../web/label-markup.js'));
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'label-markup-cases.json'), 'utf8'));
  const results = runCases(parse, cases);
  results.forEach(r => console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.detail ? ' ' + r.detail : '')));
  // lines without markers come back untouched, whatever the characters
  for (const t of ['', 'a', 'Mix 1/2 (3) {x}', '€ ü \\ ~ ^']) {
    const g = parse(t);
    if (g.marked || g.plain !== t || g.pieces.length !== 1) { console.log('FAIL untouched ' + JSON.stringify(t)); results.push({ ok: false }); }
  }
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
