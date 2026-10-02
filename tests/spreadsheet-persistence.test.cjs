// Run: node --test tests/spreadsheet-persistence.test.cjs
// Tests the actual production closures with a deterministic clock and mocked
// editor dependencies. These are lifecycle tests, not browser/layout tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/inline-spreadsheet.ts'), 'utf8');
const ast = ts.createSourceFile('inline-spreadsheet.ts', source, ts.ScriptTarget.Latest, true);
let flushSource;
let teardownSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'flush') {
    flushSource = node.initializer.getText(ast);
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'destroy'
      && ts.isArrowFunction(node.initializer)) {
    const statements = node.initializer.body.statements;
    const end = statements.findIndex(statement => statement.getText(ast) === 'disposed = true;');
    if (end >= 0) {
      // Exercise persistence/disposal ordering without unrelated DOM cleanup.
      teardownSource = `(discardChanges = false) => {${statements.slice(0, end + 1).map(s => s.getText(ast)).join('\n')}}`;
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(flushSource && teardownSource, 'Production lifecycle closures must be found');

function harness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const writes = [];
  const context = vm.createContext({
    changeTimer: null, pendingChange: null, disposed: false,
    window: { clearTimeout: id => timers.delete(id) },
    options: { onChange: value => writes.push(value.data[0][0]) },
  });
  const queue = value => {
    timers.delete(context.changeTimer);
    context.pendingChange = { data: [[value]] };
    context.changeTimer = nextId++;
    timers.set(context.changeTimer, { at: now + 500, value });
  };
  let cellDraft;
  let formulaDraft;
  context.commitRescueInput = () => {
    if (cellDraft !== undefined) { queue(cellDraft); cellDraft = undefined; }
  };
  context.commitFormulaInput = () => {
    if (formulaDraft !== undefined) { queue(formulaDraft); formulaDraft = undefined; }
  };
  const js = ts.transpileModule(`globalThis.flush = ${flushSource}; globalThis.destroy = ${teardownSource};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(js, context);
  return {
    context, writes, queue,
    cell: value => { cellDraft = value; },
    formula: value => { formulaDraft = value; },
    tick: milliseconds => {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          writes.push(timer.value);
          context.pendingChange = null;
          context.changeTimer = null;
        }
      }
    },
  };
}

test('queued values and formulas survive flush on either side of the debounce boundary', () => {
  for (const delay of [0, 1, 100, 499, 500, 501, 1000]) {
    for (const value of ['new text', '=SUM(A1:A5)', '', '0']) {
      const h = harness();
      h.queue(value);
      h.tick(delay);
      h.context.flush();
      h.tick(1000);
      assert.deepEqual(h.writes, [value], `delay=${delay}, value=${value}`);
    }
  }
});

test('rapid queued edits persist only the latest value', () => {
  const h = harness();
  for (let i = 0; i < 1000; i++) h.queue(String(i));
  h.context.flush();
  h.tick(1000);
  assert.deepEqual(h.writes, ['999']);
});

for (const mode of ['cell', 'formula']) {
  test(`scroll teardown commits an active ${mode} draft before flushing`, () => {
    const h = harness();
    h[mode]('=A1+2');
    h.context.destroy(false);
    h.context.destroy(false);
    h.tick(1000);
    assert.deepEqual(h.writes, ['=A1+2']);
  });

  test(`popup/save flush must commit an active ${mode} draft`, {
    todo: 'Known gap: flush drains the queue but does not commit active inputs',
  }, () => {
    const h = harness();
    h[mode]('=A1+2');
    h.context.flush();
    assert.deepEqual(h.writes, ['=A1+2']);
  });
}

test('refresh/discard cannot overwrite replacement content with an old queued edit', () => {
  const h = harness();
  h.queue('stale inline data');
  h.cell('stale active cell');
  h.context.destroy(true);
  h.tick(1000);
  assert.deepEqual(h.writes, []);
  assert.equal(h.context.disposed, true);
});

test('separate table instances never flush into one another', () => {
  const first = harness();
  const second = harness();
  first.queue('table one');
  second.queue('table two');
  second.context.flush();
  assert.deepEqual(first.writes, []);
  first.context.destroy(false);
  assert.deepEqual(first.writes, ['table one']);
  assert.deepEqual(second.writes, ['table two']);
});
