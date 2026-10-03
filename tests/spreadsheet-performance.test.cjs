const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/ts/custom-editor/SpreadsheetPerformance.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { createSpreadsheetLayoutGate, createSpreadsheetSnapshotCache } = context.exports;

test('idle geometry work is bounded while active editing retains every frame', () => {
  const idle = createSpreadsheetLayoutGate();
  const active = createSpreadsheetLayoutGate();
  let idleChecks = 0, activeChecks = 0;
  for (let frame = 0; frame < 600; frame++) {
    const now = frame * 1000 / 60;
    idleChecks += Number(idle.shouldMeasure(now, false));
    activeChecks += Number(active.shouldMeasure(now, true));
  }
  assert.ok(idleChecks <= 40, `idle checks: ${idleChecks}`);
  assert.equal(activeChecks, 600);
  console.log(`10 simulated seconds at 60Hz: baseline 600 geometry passes; gated idle ${idleChecks}; active ${activeChecks}`);
});

test('scroll/resize invalidation wakes layout immediately and safety check remains', () => {
  const gate = createSpreadsheetLayoutGate();
  assert.equal(gate.shouldMeasure(0, false), true);
  assert.equal(gate.shouldMeasure(20, false), false);
  gate.invalidate(21);
  assert.equal(gate.shouldMeasure(21, false), true);
  assert.equal(gate.shouldMeasure(350, false), true);
  assert.equal(gate.shouldMeasure(400, false), false);
  assert.equal(gate.shouldMeasure(601, false), true);
});

test('unchanged snapshots are normalized once; changed snapshots invalidate safely', () => {
  let calls = 0;
  const cached = createSpreadsheetSnapshotCache(html => { calls++; return html.toUpperCase(); });
  const level = { content: 'original' };
  for (let i = 0; i < 1000; i++) assert.equal(cached(level), 'ORIGINAL');
  assert.equal(calls, 1);
  level.content = 'changed';
  assert.equal(cached(level), 'CHANGED');
  assert.equal(calls, 2);
  assert.equal(cached({ content: 'other' }), 'OTHER');
  assert.equal(calls, 3);
});
