const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,
  '../src/ts/custom-editor/SpreadsheetExtension.ts'), 'utf8');

// removeOverlayIfStillOutOfView is a closure nested inside
// registerSpreadsheetExtension, not a top-level function declaration, so it
// can't be found by name the way the other extracted-function tests do --
// pulled out by its own distinctive source text instead.
const start = source.indexOf('const pendingOverlayRemovals = new Set');
const end = source.indexOf('const tableVisibility = new IntersectionObserver');
assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate the snippet in the source');
const snippet = `${source.slice(start, end)}\nglobalThis.__removeOverlayIfStillOutOfView = removeOverlayIfStillOutOfView;\n`;

function run() {
  const frames = [];
  let nearViewport = true;
  const removed = [];
  // The map of mounted overlays, the table last used and the focused element are read by the function under test
  const spreadsheetOverlays = new Map();
  const doc = { activeElement: null };
  const context = vm.createContext({
    window: { requestAnimationFrame: cb => frames.push(cb) },
    document: doc,
    spreadsheetOverlays,
    lastActiveSpreadsheetTable: null,
    isNearViewport: () => nearViewport,
    removeOverlay: table => removed.push(table),
  });
  vm.runInContext(ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return {
    fn: context.__removeOverlayIfStillOutOfView,
    frames,
    removed,
    setNearViewport: v => { nearViewport = v; },
    // a table with a mounted overlay; a preview by default, or a live grid that may hold the focus
    mount: (table, { isPreview = true, containsFocus = false } = {}) => {
      const el = { contains: node => containsFocus && node === doc.activeElement };
      spreadsheetOverlays.set(table, { isPreview, el });
      return el;
    },
    focus: node => { doc.activeElement = node; },
    setLastActive: table => { context.lastActiveSpreadsheetTable = table; },
    runFrames: () => { const jobs = frames.splice(0); jobs.forEach(cb => cb()); },
  };
}

test('a single out-of-view reading schedules a frame instead of removing immediately', () => {
  const h = run();
  const table = {};
  h.mount(table);
  h.setNearViewport(false);
  h.fn(table);
  assert.equal(h.frames.length, 1);
  assert.deepEqual(h.removed, []);
});

test('still out of view a frame later: the overlay is actually removed', () => {
  const h = run();
  const table = {};
  h.mount(table);
  h.setNearViewport(false);
  h.fn(table);
  h.runFrames();
  assert.deepEqual(h.removed, [table]);
});

test('back in view by the next frame: a transient false negative never removes the overlay', () => {
  const h = run();
  const table = {};
  h.mount(table);
  h.setNearViewport(false);
  h.fn(table);
  h.setNearViewport(true);
  h.runFrames();
  assert.deepEqual(h.removed, []);
});

test('a second out-of-view call for the same table while one is already pending does not double-schedule', () => {
  const h = run();
  const table = {};
  h.mount(table);
  h.setNearViewport(false);
  h.fn(table);
  h.fn(table);
  assert.equal(h.frames.length, 1);
  h.runFrames();
  assert.deepEqual(h.removed, [table]);
});

test('two different tables are tracked independently', () => {
  const h = run();
  const a = {}, b = {};
  h.mount(a);
  h.mount(b);
  h.setNearViewport(false);
  h.fn(a);
  h.fn(b);
  assert.equal(h.frames.length, 2);
  h.runFrames();
  assert.deepEqual(h.removed, [a, b]);
});

test('a table with no mounted overlay is ignored: nothing is scheduled', () => {
  const h = run();
  h.setNearViewport(false);
  h.fn({});
  assert.equal(h.frames.length, 0);
  assert.deepEqual(h.removed, []);
});

test('the grid being edited stays mounted while scrolled away (last used table, or focus inside it)', () => {
  const live = run();
  const used = {};
  live.mount(used, { isPreview: false });
  live.setLastActive(used);
  live.setNearViewport(false);
  live.fn(used);
  live.runFrames();
  assert.deepEqual(live.removed, []);

  const focused = run();
  const other = {};
  const input = {};
  focused.mount(other, { isPreview: false, containsFocus: true });
  focused.focus(input);
  focused.setNearViewport(false);
  focused.fn(other);
  focused.runFrames();
  assert.deepEqual(focused.removed, []);
});

test('a live grid that is not being used is removed when it stays out of view', () => {
  const h = run();
  const table = {};
  h.mount(table, { isPreview: false });
  h.setNearViewport(false);
  h.fn(table);
  h.runFrames();
  assert.deepEqual(h.removed, [table]);
});
