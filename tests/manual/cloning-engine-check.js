// Checks of web/sequence-viewer/cloning-engine.js without a browser: node tests/manual/cloning-engine-check.js
// The primers of a homology assembly are used as a PCR on the insert; the PCR product joined to the opened vector must be the plasmid
// that was planned (as a circle, whatever the start).
const assert = require('assert');
const engine = require('../../web/sequence-viewer/cloning-engine.js');

let seed = 7;
const random = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += 'ACGT'[(seed >> 16) & 3];
  }
  return s;
};
const rc = engine.reverseComplement;
const sameCircle = (a, b) => a.length === b.length && (a + a).includes(b);

const vector = random(3000);
const insert = random(700);
let checks = 0;

[[500, 500], [500, 560], [2990, 40], [0, 0], [2999, 2999]].forEach(([from, to]) => {
  Object.values(engine.METHODS).forEach((method) => {
    const design = engine.designHomology({ vector, circular: true, from, to, insert, overlap: method.overlap });
    const removed = to >= from ? to - from : to - from + vector.length;
    // the PCR product of the two primers on the insert
    const fwdBind = design.forward.binding;
    const revBind = design.reverse.binding;
    assert.ok(insert.startsWith(fwdBind), 'forward binding is the start of the insert');
    assert.ok(insert.endsWith(rc(revBind)), 'reverse binding is the end of the insert');
    const product = design.forward.tail + insert + rc(design.reverse.tail);
    // the opened vector: what is left when the place is removed, as a line that starts at the end of the place
    const kept = (vector + vector).slice(from + removed, from + vector.length);
    // the PCR product overlaps the kept vector at both ends: the assembly is the kept vector followed by the insert part of the product
    assert.ok(product.startsWith(kept.slice(kept.length - method.overlap)), 'left tail is the vector before the place');
    assert.ok(product.endsWith(kept.slice(0, method.overlap)), 'right tail is the vector after the place');
    const assembled = kept + product.slice(method.overlap, product.length - method.overlap);
    const planned = vector.slice(0, from) + insert + vector.slice(from + removed) ;
    const plannedWrapped = (vector + vector).slice(from + removed, from + vector.length) + insert;
    assert.ok(sameCircle(assembled, plannedWrapped), 'assembled plasmid is the planned one (' + method.label + ' ' + from + '..' + to + ')');
    assert.strictEqual(assembled.length, design.productLength);
    if (to >= from) {
      assert.ok(sameCircle(assembled, planned), 'matches the plain splice');
    }
    checks++;
  });
});

assert.throws(() => engine.designHomology({ vector, circular: false, from: 1, to: 1, insert, overlap: 15 }), /circular/);
assert.throws(() => engine.designHomology({ vector, circular: true, from: 1, to: 1, insert: 'ACGT', overlap: 15 }), /20 bases/);
assert.throws(() => engine.designHomology({ vector: random(40), circular: true, from: 1, to: 1, insert, overlap: 15 }), /too short/);
assert.throws(() => engine.designHomology({ vector, circular: true, from: 10, to: 2990, insert, overlap: 25 }), /too little/);
console.log('cloning engine: ' + checks + ' assemblies check out');
