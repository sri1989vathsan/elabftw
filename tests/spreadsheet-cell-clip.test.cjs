const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,
  '../src/ts/inline-spreadsheet.ts'), 'utf8');
const ast = ts.createSourceFile('inline-spreadsheet.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name.text === 'applyCellClipHeights');
assert.ok(fn);

const CELL_CLIP_CLASS = 'jss-cell-clip';
const MIN_DATA_ROW_HEIGHT = 20;

function makeCell({ editor = false, hasWrapper = false } = {}) {
  let wrapper = hasWrapper
    ? { className: CELL_CLIP_CLASS, style: {}, firstChild: null, remove: () => { wrapper = null; } }
    : null;
  const children = [];
  return {
    classList: { contains: cls => cls === 'editor' && editor },
    querySelector: sel => (sel === `:scope > .${CELL_CLIP_CLASS}` ? wrapper : null),
    appendChild: child => { children.push(child); wrapper = child; },
    insertBefore: () => {},
    get firstChild() { return null; },
    _wrapperRef: () => wrapper,
  };
}

function makeRow(cells) {
  return {
    style: {},
    querySelectorAll: () => cells,
  };
}

function runWithContext(rows, anyWrapperExists) {
  const calls = { querySelectorAll: 0 };
  const container = {
    querySelector: sel => (sel === `.${CELL_CLIP_CLASS}` ? (anyWrapperExists ? {} : null) : null),
    querySelectorAll: () => { calls.querySelectorAll++; return rows; },
  };
  const context = vm.createContext({
    CELL_CLIP_CLASS,
    MIN_DATA_ROW_HEIGHT,
    window: {
      getComputedStyle: () => ({
        paddingTop: '2px', paddingBottom: '2px', borderTopWidth: '1px', borderBottomWidth: '1px',
        lineHeight: '16px', fontSize: '12px',
      }),
    },
    document: { createElement: () => ({ className: '', style: {}, firstChild: null }) },
  });
  vm.runInContext(ts.transpileModule(fn.getText(ast), {}).outputText, context);
  return { fn: context.applyCellClipHeights, container, calls };
}

test('nothing to do: no manual heights and no existing wrapper anywhere -- skips the full row/cell walk entirely', () => {
  const rowsThatMustNeverBeTouched = [makeRow([makeCell()])];
  const { fn, container, calls } = runWithContext(rowsThatMustNeverBeTouched, false);
  fn(container, new Map());
  assert.equal(calls.querySelectorAll, 0, 'the expensive per-row walk must not run');
});

test('a manually-resized row still gets clipped correctly (early-return guard does not suppress real work)', () => {
  const cell = makeCell();
  const row = makeRow([cell]);
  const { fn, container, calls } = runWithContext([row], false);
  fn(container, new Map([[0, 40]]));
  assert.equal(calls.querySelectorAll, 1);
  assert.equal(row.style.height, '40px');
  assert.ok(cell._wrapperRef(), 'a clip wrapper should have been created');
});

test('an existing wrapper with no manual heights left still gets unwrapped (early-return guard respects it)', () => {
  const cell = makeCell({ hasWrapper: true });
  const row = makeRow([cell]);
  const { fn, container, calls } = runWithContext([row], true);
  fn(container, new Map());
  assert.equal(calls.querySelectorAll, 1, 'must still walk rows once a wrapper exists, to tear it down');
});
