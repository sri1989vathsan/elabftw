const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/folder-dragdrop.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, document: {}, window: {},
  require: id => (id === './i18n' ? { default: { t: key => key } } : { Api: class {}, currentFlatFolderLevel: () => null, forgetFolderEntries: () => {} }),
});
const { dropTargetFolder } = mod.exports;

test('a folder id is a target for both folders and files', () => {
  assert.equal(dropTargetFolder('folder', '12'), '12');
  assert.equal(dropTargetFolder('entry', '12'), '12');
});

test('"All" takes folders only, "Unfiled" takes files only, the first level\'s up row takes both', () => {
  assert.equal(dropTargetFolder('folder', 'root'), null);
  assert.equal(dropTargetFolder('entry', 'root'), undefined);
  assert.equal(dropTargetFolder('entry', 'unfiled'), null);
  assert.equal(dropTargetFolder('folder', 'unfiled'), undefined);
  assert.equal(dropTargetFolder('folder', 'top'), null);
  assert.equal(dropTargetFolder('entry', 'top'), null);
});

test('anything else is not a target', () => {
  assert.equal(dropTargetFolder('entry', ''), undefined);
  assert.equal(dropTargetFolder('entry', 'abc'), undefined);
  assert.equal(dropTargetFolder('folder', '1; DROP'), undefined);
});
