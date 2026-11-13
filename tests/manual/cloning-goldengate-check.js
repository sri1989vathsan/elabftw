// Checks of the Golden Gate assembly of web/sequence-viewer/cloning-engine.js without a browser: node tests/manual/cloning-goldengate-check.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../../web/sequence-viewer/cloning-engine.js');

const line = fs.readFileSync(path.join(__dirname, '../../web/sequence-viewer/enzymes-library.js'), 'utf8').split('\n').find((l) => l.startsWith('window.EnzymeLibrary ='));
global.window = {};
eval(line);
const library = global.window.EnzymeLibrary;
const enz = (name) => engine.findEnzyme(library, name);
const rc = engine.reverseComplement;
const sameCircle = (a, b) => a.length === b.length && (a + a).includes(b);

let seed = 3;
const random = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(seed >> 16) & 3];
  }
  return s.replace(/GGTCTC|GAGACC|CGTCTC|GAGACG|GAAGAGC|GCTCTTC/g, 'AAAAAA');
};
const BSAI_LEFT = (overhang) => 'GGTCTC' + 'A' + overhang; // the site cuts to its right: one base, then the 4-base overhang
const BSAI_RIGHT = (overhang) => overhang + 'T' + 'GAGACC'; // the site on the other strand cuts to its left

// a destination with a dropout: the sites lie on the dropout, so the dropout leaves with them
const pre = random(900);
const post = random(900);
const dropout = random(300);
const destination = pre + 'ACCT' + 'A' + 'GAGACC' + dropout + 'GGTCTC' + 'A' + 'GGCT' + post;
// parts: 1 from ACCT to TGCC, 2 from TGCC to AATG, 3 from AATG to GGCT, each as a PCR product with padding and the sites on the outside
const body = [random(400), random(250), random(500)];
const make = (from, bodyText, to) => 'CCCCCC' + BSAI_LEFT(from) + bodyText + BSAI_RIGHT(to) + 'CCCCCC';
const part1 = make('ACCT', body[0], 'TGCC');
const part2 = make('TGCC', body[1], 'AATG');
const part3 = make('AATG', body[2], 'GGCT');
const expected = pre + 'ACCT' + body[0] + 'TGCC' + body[1] + 'AATG' + body[2] + 'GGCT' + post;
const features = { f: { id: 'f', name: 'marker', type: 'CDS', start: 100, end: 300, strand: 1 } };
const partFeature = { g: { id: 'g', name: 'cds', type: 'CDS', start: 6 + 6 + 1 + 4 + 10, end: 6 + 6 + 1 + 4 + 109, strand: 1 } };

const run = (parts, extra = {}) => engine.designGoldenGate(Object.assign({ enzyme: enz('BsaI'), destination: { sequence: destination, circular: true, features }, parts }, extra));
const asParts = (list) => list.map((sequence, index) => ({ name: 'Part ' + (index + 1), sequence, circular: false, features: index === 1 ? partFeature : {} }));

// the parts in any order give the same plasmid, in order of their overhangs
[[part1, part2, part3], [part3, part1, part2], [part2, part3, part1]].forEach((order) => {
  const result = run(asParts(order));
  assert.strictEqual(result.assemblies.length, 1, 'one assembly');
  const a = result.assemblies[0];
  assert.ok(sameCircle(a.sequence, expected), 'the plasmid is the destination with the three bodies in place of the dropout');
  assert.strictEqual(a.stable, true);
  assert.strictEqual(a.order.length, 4);
  assert.deepStrictEqual(a.overhangs.map((o) => o.sequence).sort(), ['AATG', 'ACCT', 'GGCT', 'TGCC']);
  assert.ok(Object.values(a.features).some((f) => f.name === 'marker'), 'the destination feature follows');
});
{
  const a = run(asParts([part1, part2, part3])).assemblies[0];
  const cds = Object.values(a.features).find((f) => f.name === 'cds');
  const start = a.sequence.indexOf(body[1].slice(0, 20));
  assert.ok(cds && a.sequence.slice(cds.start, cds.end + 1) === body[1].slice(10, 110), 'the feature of a part lies on its bases');
  assert.ok(start > 0);
}

// a part given on the other strand is turned
{
  const result = run(asParts([part1, rc(part2), part3]));
  assert.ok(sameCircle(result.assemblies[0].sequence, expected));
  assert.strictEqual(result.assemblies[0].order.filter((o) => o.orientation === 'reverse').length >= 1, true);
}

// a part from an entry vector: the insert is cut out and its backbone (that keeps the sites) is not used
{
  const entry = random(700) + BSAI_LEFT('TGCC') + body[1] + BSAI_RIGHT('AATG') + random(700);
  const result = run([{ name: 'Entry', sequence: entry, circular: true, features: {} }, { name: 'P1', sequence: part1, circular: false, features: {} }, { name: 'P3', sequence: part3, circular: false, features: {} }]);
  assert.strictEqual(result.assemblies.length, 1);
  assert.ok(sameCircle(result.assemblies[0].sequence, expected));
}

// errors and warnings
// a part is missing: no ring, the overhangs without a partner are named
{
  const result = run(asParts([part1, part3]));
  assert.strictEqual(result.assemblies.length, 0);
  assert.ok(result.warnings.some((w) => /No assembly closes/.test(w) && /TGCC|AATG/.test(w)), 'the lonely overhangs are named');
}
assert.throws(() => run([{ name: 'Plain', sequence: random(500), circular: false, features: {} }]), /does not cut Plain/);
assert.throws(() => engine.designGoldenGate({ enzyme: enz('BsaI'), destination: { sequence: destination, circular: false }, parts: asParts([part1]) }), /circular/);
assert.throws(() => engine.designGoldenGate({ enzyme: enz('EcoRI'), destination: { sequence: 'AAAAAAAAAAAAAAAAAAAAGAATTCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAATTC', circular: true }, parts: asParts([part1]) }), /does not cut Part 1|blunt|only once/);

// a palindromic overhang is flagged
{
  const palindromic = make('ACCT', body[0], 'GCGC');
  const second = make('GCGC', body[1], 'GGCT');
  const result = run(asParts([palindromic, second]));
  assert.strictEqual(result.assemblies.length, 1);
  assert.ok((result.assemblies[0].warn || []).some((w) => /palindromic/.test(w)));
}

// another enzyme (BsmBI, SapI with its 3 base overhang) works the same way
{
  const sap = enz('SapI');
  const left = (o) => 'GCTCTTC' + 'A' + o;
  const right = (o) => o + 'T' + 'GAAGAGC';
  const dest = pre + 'ACC' + 'T' + 'GAAGAGC' + dropout + 'GCTCTTC' + 'A' + 'GGC' + post;
  const p1 = 'CCCCCC' + left('ACC') + body[0] + right('TGC') + 'CCCCCC';
  const p2 = 'CCCCCC' + left('TGC') + body[1] + right('GGC') + 'CCCCCC';
  const result = engine.designGoldenGate({ enzyme: sap, destination: { sequence: dest, circular: true, features: {} }, parts: [{ name: 'a', sequence: p2, circular: false }, { name: 'b', sequence: p1, circular: false }] });
  assert.ok(sameCircle(result.assemblies[0].sequence, pre + 'ACC' + body[0] + 'TGC' + body[1] + 'GGC' + post));
}
console.log('golden gate: all checks pass');
