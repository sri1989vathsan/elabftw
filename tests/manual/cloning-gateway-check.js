// Checks of the Gateway part of js/cloning-engine.js without a browser: node tests/manual/cloning-gateway-check.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../../web/sequence-viewer/cloning-engine.js');

const rc = engine.reverseComplement;
const sameCircle = (a, b) => a.length === b.length && (a + a).includes(b);
let seed = 5;
const random = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(seed >> 16) & 3];
  }
  return s.replace(/TTTGTA/g, 'AAAAAA');
};
const C1 = 'TTTGTACAAAAAAGC';
const C2 = 'TTTGTACAAGAAAGC';
const real = JSON.parse(fs.readFileSync(path.join(__dirname, './cloning-att-sites.json'), 'utf8'));

// the real sites are recognised as what they are
{
  const kind = (sequence) => engine.findAttSites(sequence, false).map((s) => s.name + (s.strand < 0 ? '-' : '+'));
  assert.deepStrictEqual(kind(real.attB1), ['attB1+']);
  assert.deepStrictEqual(kind(real.attB2), ['attB2+']);
  assert.deepStrictEqual(kind(real.attL1), ['attL1+']);
  assert.deepStrictEqual(kind(real.attL2), ['attL2+']);
  assert.deepStrictEqual(kind(real.attR1), ['attR1+']);
  assert.deepStrictEqual(kind(real.attR2), ['attR2+']);
  assert.deepStrictEqual(kind(real.attP1), ['attP1+'], 'the attP1 with one base different on each side');
  assert.deepStrictEqual(kind(real.attP2), ['attP2+']);
  assert.deepStrictEqual(kind(rc(real.attL1)), ['attL1-'], 'on the other strand');
  assert.deepStrictEqual(kind('GGGG' + real.attB1 + random(300) + rc(real.attB2) + 'GGGG'), ['attB1+', 'attB2-']);
  assert.deepStrictEqual(kind(random(500)), []);
}

// BP with the real sites: a PCR product with attB1/attB2 and a donor vector with attP1/attP2 and ccdB between them
const gene = random(900);
const pcr = 'GGGG' + real.attB1 + gene + rc(real.attB2) + 'GGGG';
const bb1 = random(800);
const bb2 = random(700);
const ccdB = real.ccdB;
const donorVector = bb1 + real.attP1 + ccdB + rc(real.attP2) + bb2;
const features = { g: { id: 'g', name: 'gene', type: 'CDS', start: 4 + 25, end: 4 + 25 + 899, strand: 1 }, k: { id: 'k', name: 'KanR', type: 'CDS', start: 100, end: 400, strand: 1 } };
let entry;
{
  const result = engine.designGateway({ donor: { sequence: pcr, circular: false, features: { g: features.g } }, recipient: { sequence: donorVector, circular: true, features: { k: features.k } } });
  assert.strictEqual(result.reaction, 'BP');
  assert.deepStrictEqual(result.clone.sites, ['attL1', 'attL2'], 'the entry clone has attL1 and attL2');
  assert.strictEqual(result.recipient.hasCcdB, true);
  assert.strictEqual(result.byproduct, null, 'a linear donor leaves no circular by-product');
  assert.deepStrictEqual(result.warnings, []);
  // the entry clone holds the gene between the two attL sites, and the backbone of the donor vector
  assert.ok(result.clone.sequence.includes(gene), 'the gene is in the clone');
  assert.ok(!result.clone.sequence.includes(ccdB), 'ccdB is gone');
  assert.ok(result.clone.sequence.includes(bb1) && result.clone.sequence.includes(bb2), 'the backbone stays');
  const names = Object.values(result.clone.features).map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['KanR', 'gene']);
  const g = Object.values(result.clone.features).find((f) => f.name === 'gene');
  assert.strictEqual(result.clone.sequence.slice(g.start, g.end + 1), gene, 'the gene feature lies on the gene');
  entry = result.clone;
  // the exact plasmid: backbone arc, core 1, the part between the sites of the donor, core 2 (reverse), as a circle
  const expected = rc(real.attP2).slice(rc(real.attP2).indexOf(rc(C2)) + 15) + bb2 + bb1 + real.attP1.slice(0, real.attP1.indexOf(C1)) + C1 + real.attB1.slice(real.attB1.indexOf(C1) + 15) + gene + rc(real.attB2).slice(0, rc(real.attB2).indexOf(rc(C2))) + rc(C2);
  assert.ok(sameCircle(result.clone.sequence, expected), 'the plasmid is the expected one');
}

// the donor given on the other strand gives the same plasmid
{
  const a = engine.designGateway({ donor: { sequence: pcr, circular: false }, recipient: { sequence: donorVector, circular: true } });
  const b = engine.designGateway({ donor: { sequence: rc(pcr), circular: false }, recipient: { sequence: rc(donorVector), circular: true } });
  assert.ok(sameCircle(a.clone.sequence, b.clone.sequence) || sameCircle(a.clone.sequence, rc(b.clone.sequence)));
}

// LR: the entry clone and a destination vector (attR1, ccdB, attR2) give an expression clone with attB1 and attB2, and a by-product with attP sites
{
  const destination = random(600) + real.attR1 + ccdB + rc(real.attR2) + random(600);
  const result = engine.designGateway({ donor: { sequence: entry.sequence, circular: true, features: entry.features }, recipient: { sequence: destination, circular: true, features: {} } });
  assert.strictEqual(result.reaction, 'LR');
  assert.deepStrictEqual(result.clone.sites, ['attB1', 'attB2']);
  assert.ok(result.clone.sequence.includes(gene));
  assert.ok(!result.clone.sequence.includes(ccdB));
  assert.ok(result.byproduct && result.byproduct.sites.join() === 'attP1,attP2', 'the by-product holds attP1 and attP2');
  assert.ok(result.byproduct.sequence.includes(ccdB), 'and ccdB');
  assert.ok(Object.values(result.clone.features).some((f) => f.name === 'gene'), 'the gene feature follows into the expression clone');
}

// errors
assert.throws(() => engine.designGateway({ donor: { sequence: pcr, circular: false }, recipient: { sequence: random(500) + real.attR1 + ccdB + rc(real.attR2) + random(300), circular: true } }), /do not recombine/);
assert.throws(() => engine.designGateway({ donor: { sequence: 'GGGG' + real.attB1 + gene + rc(real.attB1) + 'GGGG', circular: false }, recipient: { sequence: donorVector, circular: true } }), /same core|needs two/);
// the same vector written with its sites the other way round is the same vector
assert.ok(engine.designGateway({ donor: { sequence: pcr, circular: false }, recipient: { sequence: bb1 + real.attP2 + ccdB + rc(real.attP1) + bb2, circular: true } }).clone.sites.join() === 'attL1,attL2');
assert.throws(() => engine.designGateway({ donor: { sequence: random(300), circular: false }, recipient: { sequence: donorVector, circular: true } }), /0 att sites/);
assert.throws(() => engine.designGateway({ donor: { sequence: 'GGGG' + real.attB1 + gene + real.attB2 + 'GGGG', circular: false }, recipient: { sequence: donorVector, circular: true } }), /point the same way/);
{
  const attB3 = 'ACAACTTTGTATAATAAAGTTGTA';
  const mismatch = engine.findAttSites(random(100) + attB3 + random(100), false);
  assert.strictEqual(mismatch[0].core, 3);
}
// ccdB missing from the part that is replaced: a warning, not an error
{
  const withoutCcdB = bb1 + real.attP1 + random(500) + rc(real.attP2) + bb2;
  const result = engine.designGateway({ donor: { sequence: pcr, circular: false }, recipient: { sequence: withoutCcdB, circular: true } });
  assert.ok(result.warnings.some((w) => /ccdB/.test(w)));
}

// attB primers: the two primers on a gene, the product is a donor for BP
{
  const target = random(300) + gene + random(300);
  const primers = engine.designAttBPrimers({ sequence: target, from: 300, to: 300 + gene.length });
  assert.ok(primers.forward.sequence.startsWith('GGGG' + 'ACAAGTTTGTACAAAAAAGCAGGCT'));
  assert.ok(primers.reverse.sequence.startsWith('GGGG' + 'ACCACTTTGTACAAGAAAGCTGGGT'));
  assert.ok(gene.startsWith(primers.forward.binding) && gene.endsWith(rc(primers.reverse.binding)));
  assert.strictEqual(primers.product, 'GGGG' + real.attB1 + gene + rc(real.attB2) + 'CCCC', 'the product is the PCR product of the test above (the pad of the reverse primer reads CCCC on the top strand)');
  const bp = engine.designGateway({ donor: { sequence: primers.product, circular: false }, recipient: { sequence: donorVector, circular: true } });
  assert.ok(bp.clone.sequence.includes(gene));
  assert.throws(() => engine.designAttBPrimers({ sequence: target, from: 300, to: 310 }), /30 bases/);
  const frame = engine.designAttBPrimers({ sequence: target, from: 300, to: 300 + gene.length, extraForward: 'C' });
  assert.ok(frame.forward.sequence.includes('GGCTC' + gene.slice(0, 6)) || frame.forward.sequence.includes('AGGCTC'), 'extra bases sit between the site and the gene');
}
console.log('gateway: all checks pass');
