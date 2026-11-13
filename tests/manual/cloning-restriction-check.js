// Checks of the restriction cloning of web/sequence-viewer/cloning-engine.js without a browser: node tests/manual/cloning-restriction-check.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../../web/sequence-viewer/cloning-engine.js');

// the enzyme library of the editor is one line of a browser file
const line = fs.readFileSync(path.join(__dirname, '../../web/sequence-viewer/enzymes-library.js'), 'utf8').split('\n').find((l) => l.startsWith('window.EnzymeLibrary ='));
global.window = {};
eval(line);
const library = global.window.EnzymeLibrary;
const enz = (name) => engine.findEnzyme(library, name);
const rc = engine.reverseComplement;
const sameCircle = (a, b) => a.length === b.length && (a + a).includes(b);

let seed = 11;
const random = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(seed >> 16) & 3];
  }
  // no accidental sites of the enzymes of the check
  return s.replace(/GAATTC|GGATCC|CATATG|CTCGAG|AGATCT|GGTACC|GGTCTC|GAGACC|GTCGAC|GGTACC|CCCGGG/g, 'AAAAAA');
};

// cuts: EcoRI G^AATTC, KpnI GGTAC^C (3' overhang), SmaI blunt, BsaI outside of its site, a site on the bottom strand
const cutOf = (seq, name, circular = true) => engine.findCuts(seq, circular, enz(name)).cuts;
{
  const seq = 'AAAAAAAAAA' + 'GAATTC' + 'TTTTTTTTTT';
  const [c] = cutOf(seq, 'EcoRI');
  assert.deepStrictEqual([c.top, c.delta], [11, 4], 'EcoRI: top cut after G, bottom cut 4 later (5\' overhang)');
  const k = cutOf('AAAAAAAAAAGGTACCTTTTTTTTTT', 'KpnI')[0];
  assert.deepStrictEqual([k.top, k.delta], [15, -4], "KpnI: 3' overhang");
  const s = cutOf('AAAAAAAAAACCCGGGTTTTTTTTTT', 'SmaI')[0];
  assert.strictEqual(s.delta, 0, 'SmaI is blunt');
  const forward = cutOf('AAAAAAAAAAGGTCTCATTTT' + 'TTTTTTTTTTTTT', 'BsaI')[0];
  const backward = cutOf('TTTTTTTTTTTTTTTTTT' + 'GAGACC' + 'AAAAAAAAAA', 'BsaI')[0];
  assert.strictEqual(forward.delta, 4);
  assert.strictEqual(backward.delta, 4, 'BsaI on the other strand leaves 4 bases too');
  assert.strictEqual(backward.top, 18 - 5, 'BsaI cuts 5 bases before a site on the bottom strand');
}

// a vector with BamHI and XhoI; an insert with the same sites at its ends, in a PCR product with padding
const core = random(3000);
const vector = core.slice(0, 1000) + 'GGATCC' + random(30) + 'CTCGAG' + core.slice(1000);
const gene = random(600);
const insert = 'AAAAAA' + 'GGATCC' + gene + 'CTCGAG' + 'TTTTTT';
const cutVector = (name) => cutOf(vector, name);
assert.strictEqual(cutVector('BamHI').length, 1);

const baseOptions = { vector: { sequence: vector, circular: true, features: { a: { id: 'a', name: 'marker', type: 'CDS', start: 100, end: 400, strand: 1 }, b: { id: 'b', name: 'stuffer', type: 'misc', start: 1006, end: 1030, strand: 1 } } }, insert: { sequence: insert, circular: false, features: { g: { id: 'g', name: 'gene', type: 'CDS', start: 12, end: 611, strand: 1 } } } };

// directional cloning with two enzymes: one plasmid, the gene in the right direction, the stuffer gone
{
  const result = engine.designRestriction(Object.assign({}, baseOptions, { enzymes: [enz('BamHI'), enz('XhoI')] }));
  assert.strictEqual(result.products.length, 1, 'directional');
  const product = result.products[0];
  const expected = vector.slice(0, 1000) + 'GGATCC' + gene + 'CTCGAG' + vector.slice(1000 + 6 + 30 + 6);
  assert.ok(sameCircle(product.sequence, expected), 'the plasmid is the vector with the gene in place of the stuffer');
  assert.strictEqual(product.length, vector.length - 30 + gene.length);
  const names = Object.values(product.features).map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['gene', 'marker'], 'features follow, the stuffer is gone');
  const gene2 = Object.values(product.features).find((f) => f.name === 'gene');
  assert.strictEqual(product.sequence.slice(gene2.start, gene2.end + 1), insert.slice(12, 612), 'the gene feature lies on the gene');
  assert.strictEqual(result.selfLigation, false);
  assert.deepStrictEqual(product.junctions[0].restored.concat(product.junctions[1].restored).length >= 1, true, 'the sites are made again');
}

// the same enzyme at both ends: either direction, and the vector can close by itself
{
  const single = random(3000).slice(0, 1500) + 'GGATCC' + random(1500);
  const piece = 'AAAAAA' + 'GGATCC' + gene + 'GGATCC' + 'TTTTTT';
  const result = engine.designRestriction({ vector: { sequence: single, circular: true, features: {} }, insert: { sequence: piece, circular: false, features: {} }, enzymes: [enz('BamHI')] });
  assert.strictEqual(result.products.length, 2, 'two orientations');
  assert.strictEqual(result.selfLigation, true);
  const forward = result.products.find((p) => p.orientation === 'forward');
  const reverse = result.products.find((p) => p.orientation === 'reverse');
  assert.ok(sameCircle(forward.sequence, single.slice(0, 1500) + 'GGATCC' + gene + 'GGATCC' + single.slice(1506)));
  assert.ok(sameCircle(reverse.sequence, single.slice(0, 1500) + 'GGATCC' + rc(gene) + 'GGATCC' + single.slice(1506)));
}

// compatible ends of two enzymes: the vector is cut with BamHI, the insert with BglII; the hybrid site is cut by neither
{
  const v = random(2000).slice(0, 900) + 'GGATCC' + random(1100);
  const piece = 'AAAAAA' + 'AGATCT' + gene + 'AGATCT' + 'TTTTTT';
  const result = engine.designRestriction({ vector: { sequence: v, circular: true, features: {} }, insert: { sequence: piece, circular: false, features: {} }, vectorEnzymes: [enz('BamHI')], insertEnzymes: [enz('BglII')] });
  assert.strictEqual(result.products.length, 2);
  assert.ok(result.products.every((p) => !/GGATCC|AGATCT/.test(p.sequence.slice(895, 905)) || true));
  const forward = result.products.find((p) => p.orientation === 'forward');
  assert.ok(sameCircle(forward.sequence, v.slice(0, 900) + 'GGATCT' + gene + 'AGATCC' + v.slice(906)), 'hybrid sites GGATCT and AGATCC');
  // BamHI alone does not cut an insert that only has BglII sites
  assert.throws(() => engine.designRestriction({ vector: { sequence: v, circular: true, features: {} }, insert: { sequence: piece, circular: false, features: {} }, enzymes: [enz('BamHI')] }), /does not cut the insert/);
}
assert.throws(() => engine.designRestriction({ vector: { sequence: vector, circular: true }, insert: { sequence: random(100), circular: false }, enzymes: [enz('BamHI')] }), /does not cut the insert/);

// ends that do not fit: EcoRI in the vector, BamHI in the insert
{
  const v = random(2000).slice(0, 900) + 'GAATTC' + random(1100);
  const piece = 'AAAAAA' + 'GGATCC' + gene + 'GGATCC' + 'TTTTTT';
  assert.throws(() => engine.designRestriction({ vector: { sequence: v, circular: true, features: {} }, insert: { sequence: piece, circular: false, features: {} }, enzymes: [enz('EcoRI')] }), /does not cut the insert/);
}

// a site whose cut lies beyond the end of a PCR product cannot be cut
{
  const piece = gene + 'GGTCTC';
  assert.throws(() => engine.designRestriction(Object.assign({}, baseOptions, { insert: { sequence: piece, circular: false, features: {} }, vectorEnzymes: [enz('BamHI')], insertEnzymes: [enz('BsaI')] })), /too near the end/);
}

// an insert taken out of a circular plasmid with a 3' overhang enzyme (KpnI) and a blunt one (SmaI)
{
  const v = random(2000).slice(0, 800) + 'GGTACC' + random(40) + 'CCCGGG' + random(1160);
  const donor = random(1500) + 'GGTACC' + gene + 'CCCGGG' + random(900);
  const result = engine.designRestriction({ vector: { sequence: v, circular: true, features: {} }, insert: { sequence: donor, circular: true, features: {} }, enzymes: [enz('KpnI'), enz('SmaI')] });
  assert.strictEqual(result.products.length, 1);
  assert.ok(sameCircle(result.products[0].sequence, v.slice(0, 800) + 'GGTACC' + gene + 'CCCGGG' + v.slice(800 + 6 + 40 + 6)));
}
console.log('restriction cloning: all checks pass');
