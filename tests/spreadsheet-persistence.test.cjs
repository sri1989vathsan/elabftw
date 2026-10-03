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

test('native cell blur records the original value even after live typing changed the mirror', () => {
  let handler;
  function find(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'oneditionend') handler = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  const history = [];
  const context = vm.createContext({
    document: { body: { dataset: {} } },
    lastEditingCol: 0, lastEditingRow: 0, lastFocusWasInGrid: true,
    activeEditorCellStyles: new Map(),
    nativeCellEdit: { col: 0, row: 0, oldValue: 'before typing' },
    rawDataMirror: [['after typing']],
    notifyChange() {},
    pushCellHistoryEntry: entry => history.push(entry),
  });
  vm.runInContext(ts.transpileModule(`globalThis.endEdit = ${handler};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  context.endEdit({}, {}, 0, 0, 'after typing');
  context.endEdit({}, {}, 0, 0, 'after typing');
  assert.equal(history.length, 1, 'repeated close events must not duplicate history');
  assert.equal(history[0][0].oldValue, 'before typing');
  assert.equal(history[0][0].newValue, 'after typing');
});

test('table-local undo survives remount and never changes another table', () => {
  const names = ['cellUndoStack', 'cellRedoStack', 'pushCellHistoryEntry', 'performCellUndo', 'performCellRedo'];
  const declarations = new Map();
  const popupDeclarations = new Map();
  function collect(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
      if (!popupDeclarations.has(node.name.getText(ast))) popupDeclarations.set(node.name.getText(ast), node.getText(ast));
      declarations.set(node.name.getText(ast), node.getText(ast));
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  function mount(history, cells, popup = false) {
    const context = vm.createContext({
      options: { cellHistory: history }, MAX_CELL_HISTORY: 200,
      initialHistory: history, structuredClone,
      commitRescueInput() {}, commitFormulaInput() {},
      applyCellHistoryEntry: (changes, old) => {
        for (const change of changes) cells[`${change.col},${change.row}`] = old ? change.oldValue : change.newValue;
      },
    });
    const selected = popup ? popupDeclarations : declarations;
    const script = names.map(name => `let ${selected.get(name)};`).join('\n')
      + '\nglobalThis.push = pushCellHistoryEntry; globalThis.undo = performCellUndo; globalThis.redo = performCellRedo; globalThis.history = () => ({undo: cellUndoStack, redo: cellRedoStack});';
    vm.runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context;
  }
  const firstHistory = { undo: [], redo: [] };
  const secondHistory = { undo: [], redo: [] };
  const firstCells = { '0,0': 'latest' };
  const secondCells = { '0,0': 'other table' };
  const first = mount(firstHistory, firstCells);
  const second = mount(secondHistory, secondCells);
  first.push([{ col: 0, row: 0, oldValue: 'original', newValue: 'latest' }]);
  second.push([{ col: 0, row: 0, oldValue: '', newValue: 'other table' }]);
  const remounted = mount(firstHistory, firstCells);
  remounted.undo();
  assert.equal(firstCells['0,0'], 'original');
  assert.equal(secondCells['0,0'], 'other table');
  assert.equal(secondHistory.undo.length, 1);
  const remountedAgain = mount(firstHistory, firstCells);
  remountedAgain.redo();
  assert.equal(firstCells['0,0'], 'latest');
  remountedAgain.undo();
  remountedAgain.push([{ col: 0, row: 0, oldValue: 'original', newValue: 'new edit' }]);
  assert.equal(firstHistory.redo.length, 0, 'a new edit invalidates the shared redo stack');

  const popupCells = { ...firstCells };
  const popup = mount(firstHistory, popupCells, true);
  popup.undo();
  assert.equal(popupCells['0,0'], 'original', 'popup can undo inline edits');
  assert.equal(firstHistory.undo.length, 1, 'Cancel leaves inline history unchanged');
  popupCells['0,0'] = 'popup edit';
  popup.push([{ col: 0, row: 0, oldValue: 'original', newValue: 'popup edit' }]);
  const appliedCells = { ...popupCells };
  const appliedInline = mount(popup.history(), appliedCells);
  appliedInline.undo();
  assert.equal(appliedCells['0,0'], 'original', 'inline can undo an applied popup edit');
  appliedInline.redo();
  assert.equal(appliedCells['0,0'], 'popup edit');
});

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

  test(`popup/save flush must commit an active ${mode} draft`, () => {
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
