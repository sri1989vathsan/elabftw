'use strict';
// findSimilar of web/primer-tools.js: the primers that are like a sequence without being it (the same 3' end with another tail, or a few bases
// that differ). The file is loaded with a few stubs (it is a script of the browser).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'primer-tools.js'), 'utf8');
const win = { location: { pathname: '/x' }, addEventListener() {} };
new Function('window', 'document', 'navigator', 'fetch', code)(win, { querySelector() { return null; }, currentScript: null, body: { dataset: {} } }, {}, () => {});
const T = win.PrimerTools;
const core = 'TAGGTCCCTCGACCTGCAGACCATGGTGTCCAAGGGC';
const list = [
  { id: 1, title: 'same', sequence: core },
  { id: 2, title: 'longer tail', sequence: 'TTTTTT' + core },
  { id: 3, title: 'one base off', sequence: core.slice(0, 10) + 'A' + core.slice(11) },
  { id: 4, title: 'other', sequence: 'ACGTACGTACGTACGTACGTACGT' },
  { id: 5, title: 'reverse complement of the same', sequence: T.reverseComplement(core) },
  { id: 6, title: 'five bases off', sequence: 'GGGGG' + core.slice(5) },
];

test('similar primers: the same primer is not similar; another tail and a base off are', () => {
  const found = T.findSimilar('GGTCC' + core, list);
  const ids = found.map((item) => item.primer.id);
  // the query has the 5 bases of a tail more than the core: every primer that ends like the core shares its 3' end (the base that is off is
  // 27 bases from the end, the 5 bases off of the last one are in its tail); the unrelated one is not there
  assert.deepStrictEqual(ids.slice().sort(), [1, 2, 3, 6]);
});

test('similar primers: a base off ranks first, with its count; the exact one and its reverse complement are left out', () => {
  const found = T.findSimilar(core, list);
  assert.strictEqual(found[0].primer.id, 3);
  assert.strictEqual(found[0].count, 1);
  assert.match(found[0].text, /differs by 1 base$/);
  const ids = found.map((item) => item.primer.id);
  assert.ok(!ids.includes(1) && !ids.includes(5), 'the same primer is "in the database", not similar');
  assert.ok(ids.includes(2), 'the primer with a tail has the same 3\' end');
  assert.match(found.find((item) => item.primer.id === 2).text, /same 3′ end \(37 bases\)/);
});

test('similar primers: too short a sequence, and a share of the 3\' end under 15 bases, give nothing', () => {
  assert.deepStrictEqual(T.findSimilar('ACGT', list), []);
  assert.deepStrictEqual(T.findSimilar('TTTTTTTTTTTTTTTTCCCCCCCCCGGGG', [{ id: 9, title: 'x', sequence: 'AAAAAAAAAAAAAAAAAAAAAGGGG' }]), []);
});
