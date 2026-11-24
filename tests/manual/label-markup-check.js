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

/**
 * In the browser (any page, logged in): `await labelMarkupCheck()`. Nothing is printed: only dry runs. Compares what the server drew for several
 * lines (the pieces it returns with the picture) with what label-markup.js says, and tries the B / I / A+ / A- buttons and a {field} in a piece
 * of the dialog. `labelMarkupCheck.samples` (after a run) holds the data: PNGs of the pictures and the ZPL, to save and look at.
 */
window.labelMarkupCheck = async function labelMarkupCheck() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, ok: !!pass, detail: pass ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(150); } return fn(); };
  const token = document.querySelector('meta[name="csrf-token"]')?.content || document.body.dataset.csrf || '';
  const dry = async (custom, extra) => (await fetch('label-print.php', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token },
    body: JSON.stringify(Object.assign({ generic: true, custom, copies: 1, format: -1, dry: true }, extra || {}))
  })).json();
  ok('label-markup.js is loaded', !!window.labelMarkup, 'window.labelMarkup missing (the footer loads it)');
  if (!window.labelMarkup) return { pass: false, results };
  const flags = p => (p.bold ? 'b' : '') + (p.italic ? 'i' : '');
  const samples = {};
  const cases = [
    ['plain', 'Plasmid 12'],
    ['bold in the middle', 'pCMV **GFP** insert'],
    ['big and small', '[big]1374[/big] [small]sample of Ana[/small]'],
    ['bold italic big', '***both*** [big]**B**[/big]'],
    ['empty pieces', 'a****b [big][/big]c'],
    ['unbalanced bold', 'a **b'],
    ['unbalanced tag', '[big]x'],
    ['a lone star', '5 * 3'],
    ['too long for the label', '[big]**A very long text**[/big] that does not fit on a small label at all'],
  ];
  for (const [name, text] of cases) {
    const body = await dry(text);
    const parsed = window.labelMarkup.parse(text);
    const images = (body.elements || []).filter(e => e.type === 'image');
    samples[name] = { text, zpl: body.zpl, png: images.map(i => i.src), pieces: images.map(i => i.pieces) };
    ok(`${name}: the server answered`, body.elements, JSON.stringify(body).slice(0, 150));
    if (!body.elements) continue;
    ok(`${name}: the text line is the text without markers`, body.lines.join('|') === parsed.plain, `${body.lines.join('|')} vs ${parsed.plain}`);
    if (!parsed.marked) {
      ok(`${name}: no pieces (plain line, the old path)`, images.length === 0 || images.every(i => !i.pieces), '');
      continue;
    }
    const sp = images[0] && images[0].pieces;
    ok(`${name}: the server drew pieces`, !!sp, 'no picture with pieces');
    if (!sp) continue;
    ok(`${name}: same pieces in the same order (text, bold, italic)`, JSON.stringify(sp.map(p => [p.text, p.bold, p.italic])) === JSON.stringify(parsed.pieces.map(p => [p.text, !!p.bold, !!p.italic])), JSON.stringify(sp));
    const biggest = Math.max(...sp.map(p => p.size));
    const rels = parsed.pieces.map(p => p.scale / Math.max(...parsed.pieces.map(q => q.scale)));
    ok(`${name}: the sizes are in the proportion of the markers`, sp.every((p, i) => Math.abs(p.size / biggest - rels[i]) < 0.08), JSON.stringify(sp.map(p => p.size)));
    const total = sp.reduce((a, p) => a + p.w, 0);
    ok(`${name}: the row fits the width of the text (${total} of ${images[0].w} dots)`, total <= images[0].w && total > 0, `${total} > ${images[0].w}`);
    ok(`${name}: the picture is as high as its biggest piece`, images[0].h >= biggest && images[0].h <= Math.ceil(biggest * 1.15) + 1, `${images[0].h} vs ${biggest}`);
    ok(`${name}: the ZPL has the picture`, /\^GFA,/.test(body.zpl), '');
  }
  // alignment applies to the whole row
  const centred = await dry('a **b** c', { styles: [{ align: 'center' }] });
  const left = await dry('a **b** c');
  ok('a centred mixed line is still one picture, same pieces', (centred.elements.find(e => e.pieces) || {}).pieces?.length === 3 && (left.elements.find(e => e.pieces) || {}).pieces?.length === 3, '');
  ok('centring changes the picture', (centred.elements.find(e => e.pieces) || {}).src !== (left.elements.find(e => e.pieces) || {}).src, 'same picture');
  // the dialog
  document.querySelector('.planned-backdrop')?.remove();
  const item = document.querySelector('[data-print-label-open]');
  ok('the Tools menu has "Print label"', !!item, '');
  if (item) {
    item.click();
    const text = await waitFor(() => document.querySelector('.planned-dialog textarea'));
    ok('the dialog is there', !!text, '');
    if (text) {
      text.value = 'one two three'; text.dispatchEvent(new Event('input', { bubbles: true }));
      const bar = document.querySelector('.planned-dialog [data-label-markup-bar]');
      ok('the markup buttons are there (B, I, A+, A-)', bar && bar.querySelectorAll('button').length === 4, '');
      const press = label => [...bar.querySelectorAll('button')].find(b => b.textContent === label).click();
      text.focus(); text.setSelectionRange(4, 7); press('B');
      ok('B puts ** around the selection', text.value === 'one **two** three', text.value);
      text.setSelectionRange(6, 9); press('B');
      ok('B on the same selection takes it off', text.value === 'one two three', text.value);
      text.setSelectionRange(8, 13); press('I');
      ok('I puts * around the selection', text.value === 'one two *three*', text.value);
      text.setSelectionRange(0, 3); press('A+');
      ok('A+ puts [big] around the selection', text.value === '[big]one[/big] two *three*', text.value);
      text.setSelectionRange(0, 0); text.value = 'Plasmid {name} ok'; text.dispatchEvent(new Event('input', { bubbles: true }));
      text.setSelectionRange(9, 15); press('B');
      ok('the buttons work on a {field}', text.value === 'Plasmid **{name}** ok', text.value);
      await sleep(900);
      const input = [...document.querySelectorAll('.planned-dialog table input')][0];
      ok('the {name} has an input', !!input, '');
      if (input) {
        input.value = 'pA*B[x'; input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1500);
        const picture = document.querySelector('.planned-dialog svg image');
        ok('the preview shows the mixed line as a picture', !!picture, document.querySelector('.planned-dialog')?.innerText.slice(0, 160));
        const shown = document.querySelector('.planned-dialog [data-label-markup-bar] ~ div');
        ok('a * and a [ in a value are text, not markers', !/Preview unavailable/.test(document.querySelector('.planned-dialog').innerText), '');
        const again = await dry(window.labelMarkup.escapeValue('pA*B[x'));
        ok('an escaped value comes back as the text it was', again.lines.join('|') === 'pA*B[x', again.lines.join('|'));
      }
    }
    document.querySelector('.planned-backdrop')?.remove();
  }
  labelMarkupCheck.samples = samples;
  return { pass: results.every(r => r.ok), results: results.filter(r => !r.ok).concat(results.length ? [] : []), total: results.length };
};
