const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,
  '../src/ts/custom-editor/SpreadsheetExtension.ts'), 'utf8');
const ast = ts.createSourceFile('extension.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name.text === 'reconcileSpreadsheetRowHeights');
assert.ok(fn);

function run(kind, natural, manual) {
  const events = [], attributes = [];
  const rows = natural.map((height, index) => {
    let value = '100px';
    return {
      style: {
        removeProperty: () => { events.push(`clear${index}`); value = ''; },
        set height(v) { events.push(`write${index}`); value = v; },
        get height() { return value; },
      },
      getBoundingClientRect: () => { events.push(`read${index}`); return { height }; },
      getAttribute: () => `height: ${value};`,
      setAttribute: (name, v) => { attributes[index] = [name, v]; },
    };
  });
  const context = vm.createContext({ removeOuterTableHeight: () => events.push('outer') });
  vm.runInContext(ts.transpileModule(fn.getText(ast), {}).outputText, context);
  let selector;
  context.reconcileSpreadsheetRowHeights({ dataset: { spreadsheetStyle: kind },
    querySelectorAll: s => { selector = s; return rows; } }, manual);
  return { events, rows, attributes, selector };
}

test('row sizing batches resets, measurements and writes while preserving saved manual heights', () => {
  const h = run('spreadsheet', [24.2, 80, 31.1, 50], { 1: 12, 3: 44.6 });
  assert.deepEqual(h.events, ['outer', 'clear0', 'clear1', 'clear2', 'clear3',
    'read0', 'read2', 'write0', 'write1', 'write2', 'write3', 'outer']);
  assert.deepEqual(h.rows.map(r => r.style.height), ['25px', '20px', '32px', '45px']);
  assert.deepEqual(h.attributes[0], ['data-mce-style', 'height: 25px;']);
  assert.equal(h.selector, 'tbody > tr');
});

test('notebook rows and empty tables retain their selection and no-op behavior', () => {
  const h = run('notebook', [20, 40.5]);
  assert.equal(h.selector, 'tr');
  assert.deepEqual(h.rows.map(r => r.style.height), ['20px', '41px']);
  assert.deepEqual(run('spreadsheet', []).events, []);
});
