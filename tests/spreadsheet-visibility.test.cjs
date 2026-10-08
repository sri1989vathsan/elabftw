const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/ts/custom-editor/SpreadsheetExtension.ts'), 'utf8');
const ast = ts.createSourceFile('extension.ts', source, ts.ScriptTarget.Latest, true);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, name);
  return ts.transpileModule(`const ${found.getText(ast)};`, {}).outputText;
}

test('scroll visibility reads all table positions before mounting and shares one iframe measurement', () => {
  const events = [], frames = [];
  const tables = [1, 2, 3];
  const context = vm.createContext({
    window: { requestAnimationFrame: cb => { frames.push(cb); return frames.length; } },
    editor: { getBody: () => ({ querySelectorAll: () => tables }) },
    getEditorIframe: () => ({ getBoundingClientRect: () => { events.push('iframe'); return { top: 42 }; } }),
    isNearViewport: (table, top) => { assert.equal(top, 42); events.push(`read${table}`); return table !== 3; },
    mountPreview: table => events.push(`mount${table}`),
    removeOverlayIfStillOutOfView: table => events.push(`remove${table}`),
  });
  vm.runInContext(`let visibilityFrame = 0; ${declaration('recheckSpreadsheetVisibility')}
    recheckSpreadsheetVisibility(); recheckSpreadsheetVisibility();`, context);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(events, ['iframe', 'read1', 'read2', 'read3', 'mount1', 'mount2', 'remove3']);
});

test('offscreen tables without overlays do not schedule redundant teardown frames', () => {
  const frames = [], removed = [];
  const table = {};
  const overlays = new Map();
  const context = vm.createContext({
    spreadsheetOverlays: overlays, pendingOverlayRemovals: new Set(),
    window: { requestAnimationFrame: cb => frames.push(cb) },
    isNearViewport: () => false, lastActiveSpreadsheetTable: null,
    document: { activeElement: null }, removeOverlay: t => removed.push(t),
  });
  vm.runInContext(declaration('removeOverlayIfStillOutOfView'), context);
  context.table = table;
  vm.runInContext('removeOverlayIfStillOutOfView(table)', context);
  assert.equal(frames.length, 0);
  overlays.set(table, { isPreview: true });
  vm.runInContext('removeOverlayIfStillOutOfView(table); removeOverlayIfStillOutOfView(table)', context);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(removed, [table]);
});
