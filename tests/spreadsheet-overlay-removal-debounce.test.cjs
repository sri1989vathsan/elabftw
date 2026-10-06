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
  const context = vm.createContext({
    window: { requestAnimationFrame: cb => frames.push(cb) },
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
    runFrames: () => { const jobs = frames.splice(0); jobs.forEach(cb => cb()); },
  };
}

test('a single out-of-view reading schedules a frame instead of removing immediately', () => {
  const h = run();
  const table = {};
  h.setNearViewport(false);
  h.fn(table);
  assert.equal(h.frames.length, 1);
  assert.deepEqual(h.removed, []);
});

test('still out of view a frame later: the overlay is actually removed', () => {
  const h = run();
  const table = {};
  h.setNearViewport(false);
  h.fn(table);
  h.runFrames();
  assert.deepEqual(h.removed, [table]);
});

test('back in view by the next frame: a transient false negative never removes the overlay', () => {
  const h = run();
  const table = {};
  h.setNearViewport(false);
  h.fn(table);
  h.setNearViewport(true);
  h.runFrames();
  assert.deepEqual(h.removed, []);
});

test('a second out-of-view call for the same table while one is already pending does not double-schedule', () => {
  const h = run();
  const table = {};
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
  h.setNearViewport(false);
  h.fn(a);
  h.fn(b);
  assert.equal(h.frames.length, 2);
  h.runFrames();
  assert.deepEqual(h.removed, [a, b]);
});
