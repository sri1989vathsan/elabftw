const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/inline-spreadsheet.ts'), 'utf8');
const ast = ts.createSourceFile('inline-spreadsheet.ts', source, ts.ScriptTarget.Latest, true);
const wanted = new Set(['colLabel', 'coordinatesFromCellName', 'shiftFormulaReferences', 'lastGridCopy', 'rememberGridCopy',
  'createFormulaPasteShift', 'createPasteUndoRecorder', 'mergePastedCellStyle']);
const pieces = [];
for (const statement of ast.statements) {
  let name = null;
  if (ts.isFunctionDeclaration(statement) && statement.name) name = statement.name.text;
  else if (ts.isVariableStatement(statement)) name = statement.declarationList.declarations[0].name.getText();
  if (name && wanted.has(name)) pieces.push(statement.getText());
}
const code = ts.transpileModule(pieces.join('\n').replaceAll(/^export /gm, ''), { compilerOptions: { target: 'ES2020' } }).outputText;
const context = vm.createContext({});
vm.runInContext(code + '\nthis.api = { colLabel, rememberGridCopy, createFormulaPasteShift, createPasteUndoRecorder };', context);
const api = context.api;

test('colLabel is declared (the formula shift needs it)', () => {
  assert.equal(api.colLabel(0), 'A');
});

test('a copied formula pasted with the position as text is shifted by how far it moved and comes back as plain text', () => {
  // =A3+1 copied from B3 (column 1, row 2)
  api.rememberGridCopy(1, 2, [['6']], [['=A3+1']]);
  const hook = api.createFormulaPasteShift();
  // the grid passes cells as {value} and, from a keyboard paste, the position as text
  const result = hook.onbeforepaste({}, [[{ value: '6' }]], 2, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [['=B4+1']]);
  assert.equal(typeof result[0][0], 'string', 'plain values, not {value} objects (those pasted "[object Object]")');
});

test('text that is not what the last copy put on the clipboard is left alone', () => {
  api.rememberGridCopy(0, 0, [['x']], [['=A1']]);
  assert.equal(api.createFormulaPasteShift().onbeforepaste({}, [[{ value: 'other' }]], 1, 1), undefined);
});

test('the paste undo recorder reads the target cells from a numeric position and records what changed', () => {
  const sheet = { '1,1': 'old' };
  const recorded = [];
  const recorder = api.createPasteUndoRecorder(() => (col, row) => sheet[`${col},${row}`] ?? '', changes => recorded.push(changes));
  recorder.before([[{ value: 'a' }, { value: 'b' }]], 1, 1);
  sheet['1,1'] = 'a'; sheet['2,1'] = 'b';
  recorder.after();
  assert.deepEqual(JSON.parse(JSON.stringify(recorded)), [[
    { col: 1, row: 1, oldValue: 'old', newValue: 'a' },
    { col: 2, row: 1, oldValue: '', newValue: 'b' },
  ]]);
});
