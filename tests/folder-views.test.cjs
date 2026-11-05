const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/folder-views.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, Intl, Array, Number, document: {}, window: {},
  require: id => (id === './i18n' ? { default: { t: key => key } } : { on: () => {} }),
});
const { parseFolderView, sortFolderRows, filterFolderRows, rowsAtLevel, ancestorChain, initialFolderLevel } = mod.exports;

const row = (name, p, experiments = 0, resources = 0, description = '') => ({ name, path: p, experiments, resources, description });
const rows = [row('Plate 10', 'Lab/Plate 10', 3, 1), row('Plate 2', 'Lab/Plate 2', 7, 0), row('Archive', 'Archive', 0, 5, 'old stuff')];

test('an unknown or missing stored view falls back to the tree', () => {
  assert.equal(parseFolderView(null), 'tree');
  assert.equal(parseFolderView('grid'), 'tree');
  assert.equal(parseFolderView('details'), 'details');
  assert.equal(parseFolderView('list'), 'list');
});

test('sorting by name or path is natural and ignores case', () => {
  assert.deepEqual(Array.from(sortFolderRows(rows, 'name', 1), r => r.name), ['Archive', 'Plate 2', 'Plate 10']);
  assert.deepEqual(Array.from(sortFolderRows(rows, 'name', -1), r => r.name), ['Plate 10', 'Plate 2', 'Archive']);
  assert.deepEqual(Array.from(sortFolderRows(rows, 'path', 1), r => r.path), ['Archive', 'Lab/Plate 2', 'Lab/Plate 10']);
});

test('sorting by counts follows the direction and does not change the input', () => {
  assert.deepEqual(Array.from(sortFolderRows(rows, 'experiments', -1), r => r.name), ['Plate 2', 'Plate 10', 'Archive']);
  assert.deepEqual(Array.from(sortFolderRows(rows, 'resources', 1), r => r.name), ['Plate 2', 'Plate 10', 'Archive']);
  assert.equal(rows[0].name, 'Plate 10');
});

test('equal counts fall back to the path order', () => {
  const same = [row('B', 'B', 1), row('A', 'A', 1)];
  assert.deepEqual(Array.from(sortFolderRows(same, 'experiments', -1), r => r.name), ['A', 'B']);
});

test('the filter needs every word, in the name, path or description, in any case', () => {
  assert.deepEqual(Array.from(filterFolderRows(rows, 'plate'), r => r.name), ['Plate 10', 'Plate 2']);
  assert.deepEqual(Array.from(filterFolderRows(rows, 'LAB 2'), r => r.name), ['Plate 2']);
  assert.deepEqual(Array.from(filterFolderRows(rows, 'old'), r => r.name), ['Archive']);
  assert.equal(filterFolderRows(rows, '   ').length, 3);
  assert.equal(filterFolderRows(rows, 'nothing').length, 0);
});

const tree = [
  { id: '1', parentId: '', hasChildren: true, name: 'Vatsi' },
  { id: '2', parentId: '1', hasChildren: true, name: 'EV Project' },
  { id: '3', parentId: '2', hasChildren: false, name: 'Trogocytosis' },
  { id: '4', parentId: '', hasChildren: false, name: 'Other' },
];

test('a level lists only the folders directly inside it', () => {
  assert.deepEqual(Array.from(rowsAtLevel(tree, ''), r => r.name), ['Vatsi', 'Other']);
  assert.deepEqual(Array.from(rowsAtLevel(tree, '1'), r => r.name), ['EV Project']);
  assert.equal(rowsAtLevel(tree, '3').length, 0);
});

test('the chain runs from the top level down to the folder', () => {
  assert.deepEqual(Array.from(ancestorChain(tree, '3'), r => r.name), ['Vatsi', 'EV Project', 'Trogocytosis']);
  assert.deepEqual(Array.from(ancestorChain(tree, '4'), r => r.name), ['Other']);
  assert.equal(ancestorChain(tree, '99').length, 0);
});

test('a broken parent chain cannot loop for ever', () => {
  const loop = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
  assert.ok(ancestorChain(loop, 'a').length <= 30);
});

test('the flat views start inside the folder being looked at, or beside it when it has no subfolders', () => {
  assert.equal(initialFolderLevel(tree, '2'), '2');
  assert.equal(initialFolderLevel(tree, '3'), '2');
  assert.equal(initialFolderLevel(tree, '4'), '');
  assert.equal(initialFolderLevel(tree, null), '');
  assert.equal(initialFolderLevel(tree, '99'), '');
});

test('sorting by last modified puts the newest first when descending and keeps unknown dates last', () => {
  const dated = [
    { ...row('Old', 'Old', 1), modified: 100 },
    { ...row('Unknown', 'Unknown', 1), modified: 0 },
    { ...row('New', 'New', 1), modified: 300 },
  ];
  assert.deepEqual(Array.from(sortFolderRows(dated, 'modified', -1), r => r.name), ['New', 'Old', 'Unknown']);
  assert.deepEqual(Array.from(sortFolderRows(dated, 'modified', 1), r => r.name), ['Unknown', 'Old', 'New']);
});
