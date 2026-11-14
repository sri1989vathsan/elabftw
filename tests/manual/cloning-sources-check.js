// Checks of the pieces of open sequences and of the several-insert Gibson assembly: node tests/manual/cloning-sources-check.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../../web/sequence-viewer/cloning-engine.js');

const line = fs.readFileSync(path.join(__dirname, '../../web/sequence-viewer/enzymes-library.js'), 'utf8').split('\n').find((l) => l.startsWith('window.EnzymeLibrary ='));
global.window = {};
eval(line);
const enz = (name) => engine.findEnzyme(global.window.EnzymeLibrary, name);
const rc = engine.reverseComplement;
const sameCircle = (a, b) => a.length === b.length && (a + a).includes(b);
let seed = 17;
const random = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(seed >> 16) & 3];
  }
  return s.replace(/GGATCC|CTCGAG|GAATTC|GGTCTC|GAGACC/g, 'AAAAAA');
};

// ---- several inserts: the primers, used as PCR on each insert, give pieces that chain into the planned plasmid
const vector = random(3000);
const inserts = [random(500), random(300), random(420)];
[[500, 560], [500, 500], [2980, 40]].forEach(([from, to]) => {
  [15, 25].forEach((overlap) => {
    const design = engine.designHomologyMulti({ vector, circular: true, from, to, inserts, overlap });
    const removed = to >= from ? to - from : to - from + vector.length;
    const kept = (vector + vector).slice(from + removed, from + vector.length);
    // the PCR products
    const pieces = design.inserts.map((item, k) => item.forward.tail + inserts[k] + rc(item.reverse.tail));
    assert.ok(inserts[0].startsWith(design.inserts[0].forward.binding));
    // chain: kept vector, piece 1, 2, 3, back to the vector; each junction is an overlap of equal bases
    const chain = [kept].concat(pieces);
    let assembled = chain[0];
    for (let k = 1; k < chain.length; k++) {
      assert.strictEqual(assembled.slice(assembled.length - overlap), chain[k].slice(0, overlap), 'junction ' + k + ' overlaps');
      assembled += chain[k].slice(overlap);
    }
    assert.strictEqual(assembled.slice(assembled.length - overlap), kept.slice(0, overlap), 'the last piece overlaps the start of the vector');
    assembled = assembled.slice(0, assembled.length - overlap);
    assert.ok(sameCircle(assembled, kept + inserts.join('')), 'the plasmid is the vector with the three inserts in order');
    assert.strictEqual(assembled.length, design.productLength);
    assert.strictEqual(design.overlaps.length, 4);
    assert.strictEqual(design.inserts[1].reverse.tail, '', 'only the last insert carries the vector at its end');
  });
});
assert.throws(() => engine.designHomologyMulti({ vector, circular: true, from: 1, to: 1, inserts: [random(300), random(10), random(300)], overlap: 15 }), /Insert 2/);
assert.throws(() => engine.designHomologyMulti({ vector, circular: true, from: 1, to: 1, inserts: [], overlap: 15 }), /Add an insert/);

// ---- pieces
const plasmid = { sequence: random(1000) + 'GGATCC' + random(200) + 'CTCGAG' + random(800), circular: true, features: { a: { id: 'a', name: 'early', type: 'CDS', start: 100, end: 300, strand: 1 }, b: { id: 'b', name: 'mid', type: 'CDS', start: 1020, end: 1100, strand: -1 }, c: { id: 'c', name: 'late', type: 'CDS', start: 1500, end: 1800, strand: 1 } } };
{
  const whole = engine.extractPiece(plasmid, { mode: 'whole' });
  assert.strictEqual(whole.sequence.length, plasmid.sequence.length);
  assert.strictEqual(whole.circular, true);
  const range = engine.extractPiece(plasmid, { mode: 'range', from: 1010, to: 1210 });
  assert.strictEqual(range.sequence, plasmid.sequence.slice(1010, 1210));
  assert.strictEqual(range.circular, false);
  assert.deepStrictEqual(Object.values(range.features).map((f) => [f.name, f.start, f.end]), [['mid', 10, 90]], 'the feature inside the range follows it');
  assert.strictEqual(range.lostFeatures, 0);
  // a selection that cuts through a feature keeps the part it has, named partial
  const cutThrough = engine.extractPiece(plasmid, { mode: 'range', from: 1050, to: 1200 });
  assert.deepStrictEqual(Object.values(cutThrough.features).map((f) => [f.name, f.start, f.end]), [['mid (partial)', 0, 50]]);
  assert.strictEqual(cutThrough.partialFeatures, 1);
  const startsBefore = engine.extractPiece(plasmid, { mode: 'range', from: 1000, to: 1030 });
  assert.deepStrictEqual(Object.values(startsBefore.features).map((f) => [f.name, f.start, f.end]), [['mid (partial)', 20, 29]]);
  const none = engine.extractPiece(plasmid, { mode: 'range', from: 400, to: 600 });
  assert.strictEqual(Object.keys(none.features).length, 0, 'features wholly outside are not taken');
  const wrapped = engine.extractPiece(plasmid, { mode: 'range', from: 2000, to: 100 });
  assert.strictEqual(wrapped.sequence, (plasmid.sequence + plasmid.sequence).slice(2000, 2000 + (100 - 2000 + plasmid.sequence.length)));
  assert.throws(() => engine.extractPiece(Object.assign({}, plasmid, { circular: false }), { mode: 'range', from: 2000, to: 100 }), /not valid/);
}
{
  const fragments = engine.digestFragments(plasmid, [enz('BamHI'), enz('XhoI')]);
  assert.strictEqual(fragments.length, 2);
  const small = fragments.find((f) => f.size < 500);
  const piece = engine.extractPiece(plasmid, { mode: 'digest', enzymes: [enz('BamHI'), enz('XhoI')], index: small.index });
  assert.ok(piece.sequence.startsWith('GATCC') && piece.sequence.endsWith('TCGA'), 'the fragment with its overhangs: BamHI end and XhoI end');
  assert.strictEqual(piece.circular, false);
  assert.deepStrictEqual(Object.values(piece.features).map((f) => f.name), ['mid']);
  assert.throws(() => engine.extractPiece(plasmid, { mode: 'digest', enzymes: [enz('EcoRI')], index: 0 }), /does not cut/);
}

// ---- a vector opened by a digest: the place is where the removed part is
{
  const place = engine.placeFromDigest(plasmid, [enz('BamHI'), enz('XhoI')]);
  // BamHI G^GATCC cuts after base 1001, XhoI C^TCGAG after base 1207+... : the kept fragment is the big one, the removed part lies between the cuts
  const bam = plasmid.sequence.indexOf('GGATCC') + 1;
  const xho = plasmid.sequence.indexOf('CTCGAG') + 1;
  assert.deepStrictEqual([place.from, place.to], [bam, xho], 'the removed part lies from the BamHI cut to the XhoI cut');
  // a single cut opens the vector without removing anything
  const single = engine.placeFromDigest(plasmid, [enz('BamHI')]);
  assert.deepStrictEqual([single.from, single.to], [bam, bam]);
  // the same place in Gibson: the insert goes between the cuts
  const design = engine.designHomologyMulti({ vector: plasmid.sequence, circular: true, from: place.from, to: place.to, inserts: [random(300)], overlap: 15 });
  assert.strictEqual(design.productLength, plasmid.sequence.length - (xho - bam) + 300);
}

// ---- the primers drawn on the new plasmid: each lies whole on it, its sequence is what the plasmid has there
{
  const text = (plasmid, f) => f.start <= f.end ? plasmid.slice(f.start, f.end + 1) : plasmid.slice(f.start) + plasmid.slice(0, f.end + 1);
  [[500, 560], [500, 500], [0, 0]].forEach(([from, to]) => {
    const design = engine.designHomologyMulti({ vector, circular: true, from, to, inserts, overlap: 15 });
    const removed = to - from;
    const plasmid = vector.slice(0, from) + inserts.join('') + vector.slice(from + removed);
    const features = engine.homologyPrimerFeatures(design, ['A', 'B', 'C'], from, inserts.map((i) => i.length), plasmid.length);
    assert.strictEqual(Object.keys(features).length, 6);
    design.inserts.forEach((item, k) => {
      const f = features['primer' + (2 * k + 1)];
      const r = features['primer' + (2 * k + 2)];
      assert.strictEqual(text(plasmid, f), item.forward.sequence, 'forward primer ' + k + ' (' + from + ',' + to + ')');
      assert.strictEqual(rc(text(plasmid, r)), item.reverse.sequence, 'reverse primer ' + k);
      assert.strictEqual([f.strand, r.strand].join(), '1,-1');
    });
    assert.deepStrictEqual(Object.values(features).map((f) => f.name).slice(0, 2), ['A F', 'A R']);
  });
  // the attB primers on their product
  const gw = engine.designAttBPrimers({ sequence: random(300) + random(500) + random(300), from: 300, to: 800 });
  const marks = engine.attbPrimerFeatures(gw, ['gene attB1 F', 'gene attB2 R']);
  assert.strictEqual(gw.product.slice(marks.primer1.start, marks.primer1.end + 1), gw.forward.sequence);
  assert.strictEqual(rc(gw.product.slice(marks.primer2.start, marks.primer2.end + 1)), gw.reverse.sequence);
}
console.log('sources: all checks pass');
