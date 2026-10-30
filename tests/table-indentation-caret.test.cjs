const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/TableIndentation.class.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Number, Math, Array });
const TableIndentation = mod.exports.default;

// A minimal table node: enough for the indent code path (no wrapper yet, level 0 -> 1).
function fakeTable() {
  const style = { marginLeft: '', removeProperty() {}, };
  const doc = {
    defaultView: { getComputedStyle: () => ({ fontSize: '16px' }) },
    documentElement: {},
    createElement: () => {
      const el = { className: '', dataset: {}, style: {}, children: [], classList: { contains: c => el.className.split(' ').includes(c) }, append(t) { t.parentElement = el; }, remove() {} };
      return el;
    },
  };
  const table = {
    nodeType: 1, tagName: 'TABLE', style, ownerDocument: doc, parentElement: null,
    closest(sel) { return sel === 'table' ? table : null; },
    getAttribute: () => null,
    parentNode: { insertBefore() {} },
  };
  return table;
}

function run({ caretInTable }) {
  const calls = [];
  const table = fakeTable();
  const elsewhere = { nodeType: 1, parentElement: null, closest: () => null };
  const caret = caretInTable ? table : elsewhere;
  const editor = {
    on() {},
    getBody: () => ({ contains: () => true, querySelector: () => null }),
    selection: {
      getRng: () => ({ commonAncestorContainer: caret }),
      getNode: () => caret,
      getStart: () => caret,
      getEnd: () => caret,
      getBookmark: () => { calls.push('getBookmark'); return {}; },
      moveToBookmark: () => calls.push('moveToBookmark'),
    },
    undoManager: { transact: fn => fn() },
    nodeChanged: () => calls.push('nodeChanged'),
    focus: () => calls.push('focus'),
  };
  const indentation = new TableIndentation(editor);
  indentation.trackSelectedTable(table);
  indentation.indentSelectedTable();
  return calls;
}

test('indenting a table the caret is in restores the caret and focuses the editor', () => {
  const calls = run({ caretInTable: true });
  assert.ok(calls.includes('moveToBookmark'));
  assert.ok(calls.includes('focus'));
});

test('indenting a spreadsheet from its grid leaves the editor caret and focus alone (no jump in the text)', () => {
  const calls = run({ caretInTable: false });
  assert.ok(!calls.includes('moveToBookmark'));
  assert.ok(!calls.includes('focus'));
  assert.ok(calls.includes('nodeChanged'));
});
