const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/googleTasksSync.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, Date, Math, Array, Map, Set, String, Object, JSON, Number,
});
const { buildDesired, syncTasks, keyOf, localDate, MAX_IMPORT } = mod.exports;

// a mock Google Tasks list that behaves like the real one for the calls we use
function mockApi(initial = []) {
  const tasks = initial.map((t, i) => ({ id: `g${i}`, status: 'needsAction', ...t }));
  let next = tasks.length;
  const calls = [];
  return {
    tasks,
    calls,
    async listTasks() { return tasks.map(t => ({ ...t })); },
    async createTask(t) {
      calls.push('create');
      tasks.push({ id: `g${next++}`, status: 'needsAction', title: t.title, notes: t.notes, due: t.due ?? undefined });
    },
    async patchTask(id, patch) {
      calls.push('patch');
      const task = tasks.find(t => t.id === id);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) { delete task[k]; } else { task[k] = v; }
      }
    },
  };
}

const origin = 'https://elab.test';
const none = { experiments: [], items: [] };
const todo = (id, extra = {}) => ({ id, body: `task ${id}`, deadline: null, completed_at: null, archived_at: null, ...extra });
const minimal = { includeDetails: false, origin };
const detailed = { includeDetails: true, origin };

test('titles-only mode sends no notes, descriptions, experiment titles or links', () => {
  const [d] = buildDesired(
    [todo(1, { description: 'secret compound X', notes: 'private', deadline: '2026-11-10T14:30:00' })],
    none, minimal);
  assert.equal(d.title, 'task 1');
  assert.equal(d.due, '2026-11-10');
  assert.ok(!d.notes.includes('secret'));
  assert.ok(!d.notes.includes('private'));
  assert.ok(!d.notes.includes(origin));
  assert.ok(d.notes.includes('Deadline: 2026-11-10 14:30'));
  assert.ok(d.notes.endsWith('[elabftw:todo:1]'));
});

test('the link back opens the to-do the way the deadline notifications do', () => {
  // "/" redirects to dashboard.php and drops the query, so the link must name dashboard.php
  const [d] = buildDesired([todo(9)], none, detailed);
  assert.ok(d.notes.includes(`${origin}/dashboard.php?open=todolist&task=9`));
});

test('steps never reveal the experiment title unless details are on', () => {
  const unfinished = { experiments: [{ id: 7, title: 'Secret project', steps: [{ id: 3, body: 'Order antibody', deadline: null }] }], items: [] };
  const [m] = buildDesired([], unfinished, minimal);
  assert.equal(m.title, 'Order antibody');
  assert.ok(!m.notes.includes('Secret project'));
  assert.ok(!m.notes.includes(origin));
  const [full] = buildDesired([], unfinished, detailed);
  assert.ok(full.notes.includes('Secret project'));
  assert.ok(full.notes.includes(`${origin}/experiments.php?mode=view&id=7`));
});

test('completed and archived items are not wanted', () => {
  const out = buildDesired([todo(1, { completed_at: '2026-01-01' }), todo(2, { archived_at: '2026-01-01' }), todo(3)], none, minimal);
  assert.deepEqual(Array.from(out, d => d.key), ['todo:3']);
});

test('first sync creates everything, second sync changes nothing', async () => {
  const api = mockApi();
  const desired = buildDesired([todo(1), todo(2, { deadline: '2026-11-10T09:00:00' })], none, minimal);
  assert.deepEqual({ ...await syncTasks(api, desired) }, { created: 2, updated: 0, completed: 0, unchanged: 0 });
  api.calls.length = 0;
  assert.deepEqual({ ...await syncTasks(api, desired) }, { created: 0, updated: 0, completed: 0, unchanged: 2 });
  assert.equal(api.calls.length, 0);
});

test('an edited title and a changed or removed deadline are patched', async () => {
  const api = mockApi();
  await syncTasks(api, buildDesired([todo(1, { deadline: '2026-11-10T09:00:00' })], none, minimal));
  const r = await syncTasks(api, buildDesired([todo(1, { body: 'renamed' })], none, minimal));
  assert.equal(r.updated, 1);
  assert.equal(api.tasks[0].title, 'renamed');
  assert.equal(api.tasks[0].due, undefined);
});

test('an item that is no longer open is completed in Google, not deleted', async () => {
  const api = mockApi();
  await syncTasks(api, buildDesired([todo(1), todo(2)], none, minimal));
  const r = await syncTasks(api, buildDesired([todo(2)], none, minimal));
  assert.equal(r.completed, 1);
  assert.equal(api.tasks.length, 2);
  assert.equal(api.tasks.find(t => keyOf(t) === 'todo:1').status, 'completed');
});

test('a task ticked in Google stays ticked while the item is still open', async () => {
  const api = mockApi();
  const desired = buildDesired([todo(1)], none, minimal);
  await syncTasks(api, desired);
  api.tasks[0].status = 'completed';
  api.calls.length = 0;
  const r = await syncTasks(api, buildDesired([todo(1, { body: 'edited later' })], none, minimal));
  assert.equal(r.unchanged, 1);
  assert.equal(api.calls.length, 0);
  assert.equal(api.tasks[0].status, 'completed');
});

test('Google tasks the user made by hand (no marker) are never touched', async () => {
  const api = mockApi([{ title: 'buy milk', notes: 'mine' }]);
  await syncTasks(api, buildDesired([], none, minimal));
  assert.equal(api.tasks[0].status, 'needsAction');
  assert.equal(api.calls.length, 0);
});

test('a step and a to-do with the same number do not collide', async () => {
  const api = mockApi();
  const unfinished = { experiments: [{ id: 1, title: 'E', steps: [{ id: 5, body: 'a step', deadline: null }] }], items: [] };
  await syncTasks(api, buildDesired([todo(5)], unfinished, minimal));
  assert.equal(api.tasks.length, 2);
  assert.deepEqual(Array.from(api.tasks, keyOf).sort(), ['step:5', 'todo:5']);
});

test('mentions are turned to plain text through the injected converter', () => {
  const [d] = buildDesired([todo(1, { body: 'ask <span class="m">@Alice</span>' })], none,
    { ...minimal, toText: s => s.replace(/<[^>]*>/g, '') });
  assert.equal(d.title, 'ask @Alice');
});

test('localDate gives the local calendar day', () => {
  assert.equal(localDate('2026-11-10T09:00:00'), '2026-11-10');
});

// ---- two-way mode ------------------------------------------------------------

function mockLocal() {
  const calls = [];
  let next = 900;
  return {
    calls,
    async createTodo(t) { calls.push(['create', t]); return next++; },
    async updateTodo(id, patch) { calls.push(['update', id, patch]); },
    async completeTodo(id) { calls.push(['complete', id]); },
  };
}
const twoWay = (local, snapshot = {}, extra = {}) => ({ local, snapshot, ...extra });

test('two-way: a to-do ticked in Google is completed in eLabFTW', async () => {
  const api = mockApi();
  const local = mockLocal();
  const desired = buildDesired([todo(1)], none, minimal);
  const first = await syncTasks(api, desired, twoWay(local));
  api.tasks[0].status = 'completed';
  const r = await syncTasks(api, desired, twoWay(local, first.snapshot));
  assert.deepEqual(local.calls, [['complete', 1]]);
  assert.equal(r.completedLocal, 1);
});

test('two-way: a to-do reopened in eLabFTW is not completed again by an old tick', async () => {
  const api = mockApi();
  const local = mockLocal();
  const first = await syncTasks(api, buildDesired([todo(1)], none, minimal), twoWay(local));
  // done in eLabFTW: Google gets completed, snapshot forgets the key
  const second = await syncTasks(api, buildDesired([], none, minimal), twoWay(local, first.snapshot));
  assert.equal(api.tasks[0].status, 'completed');
  // reopened in eLabFTW
  await syncTasks(api, buildDesired([todo(1)], none, minimal), twoWay(local, second.snapshot));
  assert.deepEqual(local.calls, []);
});

test('two-way: a title edited in Google is written back to eLabFTW', async () => {
  const api = mockApi();
  const local = mockLocal();
  const desired = buildDesired([todo(1)], none, minimal);
  const first = await syncTasks(api, desired, twoWay(local));
  api.tasks[0].title = 'renamed in Google';
  const r = await syncTasks(api, desired, twoWay(local, first.snapshot));
  assert.deepEqual(JSON.parse(JSON.stringify(local.calls)), [['update', 1, { title: 'renamed in Google' }]]);
  assert.equal(r.pulled, 1);
  assert.equal(r.snapshot['todo:1'].title, 'renamed in Google');
  // eLabFTW now has the new title: the next sync is quiet
  const again = await syncTasks(api, buildDesired([todo(1, { body: 'renamed in Google' })], none, minimal), twoWay(local, r.snapshot));
  assert.equal(again.unchanged, 1);
  assert.equal(local.calls.length, 1);
});

test('two-way: when both sides changed, eLabFTW wins', async () => {
  const api = mockApi();
  const local = mockLocal();
  const first = await syncTasks(api, buildDesired([todo(1)], none, minimal), twoWay(local));
  api.tasks[0].title = 'Google edit';
  const r = await syncTasks(api, buildDesired([todo(1, { body: 'eLabFTW edit' })], none, minimal), twoWay(local, first.snapshot));
  assert.deepEqual(local.calls, []);
  assert.equal(api.tasks[0].title, 'eLabFTW edit');
  assert.equal(r.updated, 1);
});

test('two-way: a date moved in Google keeps the to-do\'s time of day', async () => {
  const api = mockApi();
  const local = mockLocal();
  const desired = buildDesired([todo(1, { deadline: '2026-11-10T14:30:00' })], none, minimal);
  const first = await syncTasks(api, desired, twoWay(local));
  api.tasks[0].due = '2026-11-12T00:00:00.000Z';
  await syncTasks(api, desired, twoWay(local, first.snapshot));
  const [, id, patch] = local.calls[0];
  assert.equal(id, 1);
  const moved = new Date(patch.deadline);
  assert.equal(localDate(patch.deadline), '2026-11-12');
  assert.equal(moved.getHours(), 14);
  assert.equal(moved.getMinutes(), 30);
});

test('two-way: a task added in Google becomes a to-do and gets its marker, once', async () => {
  const api = mockApi([{ title: 'Buy gloves', notes: 'size M', due: '2026-11-12T00:00:00.000Z' }]);
  const local = mockLocal();
  const r = await syncTasks(api, buildDesired([], none, minimal), twoWay(local, {}, { defaultTime: '09:00' }));
  assert.equal(r.imported, 1);
  assert.equal(local.calls[0][0], 'create');
  assert.equal(local.calls[0][1].title, 'Buy gloves');
  assert.equal(local.calls[0][1].notes, null, 'notes are only imported when details are on');
  assert.equal(localDate(local.calls[0][1].deadline), '2026-11-12');
  assert.equal(keyOf(api.tasks[0]), 'todo:900');
  assert.match(api.tasks[0].notes, /^size M\n\n\[elabftw:todo:900\]$/);
  // next round, eLabFTW lists the new to-do: nothing more is created anywhere
  const again = await syncTasks(api,
    buildDesired([todo(900, { body: 'Buy gloves', deadline: local.calls[0][1].deadline })], none, minimal),
    twoWay(local, r.snapshot));
  assert.equal(local.calls.length, 1);
  assert.equal(again.created + again.imported, 0);
});

test('two-way: notes are imported only with details on, and completed or blank tasks never', async () => {
  const api = mockApi([
    { title: 'with notes', notes: 'keep me' },
    { title: 'already done', status: 'completed' },
    { title: '   ' },
  ]);
  const local = mockLocal();
  const r = await syncTasks(api, buildDesired([], none, minimal), twoWay(local, {}, { includeDetails: true }));
  assert.equal(r.imported, 1);
  assert.equal(local.calls[0][1].notes, 'keep me');
});

test('two-way: at most MAX_IMPORT tasks arrive in one sync', async () => {
  const api = mockApi(Array.from({ length: MAX_IMPORT + 7 }, (_, i) => ({ title: `t${i}` })));
  const local = mockLocal();
  const r = await syncTasks(api, buildDesired([], none, minimal), twoWay(local));
  assert.equal(r.imported, MAX_IMPORT);
  const second = await syncTasks(api, buildDesired([], none, minimal), twoWay(local));
  assert.equal(second.imported, 7);
});

test('two-way: a task deleted in Google is not recreated, and the to-do stays', async () => {
  const api = mockApi();
  const local = mockLocal();
  const desired = buildDesired([todo(1)], none, minimal);
  const first = await syncTasks(api, desired, twoWay(local));
  api.tasks.length = 0;
  const second = await syncTasks(api, desired, twoWay(local, first.snapshot));
  assert.equal(api.tasks.length, 0);
  assert.equal(second.created, 0);
  const third = await syncTasks(api, desired, twoWay(local, second.snapshot));
  assert.equal(api.tasks.length, 0);
  assert.equal(third.created, 0);
  assert.deepEqual(local.calls, []);
});

test('two-way: a step ticked in Google is left alone (steps stay one-way for now)', async () => {
  const api = mockApi();
  const local = mockLocal();
  const unfinished = { experiments: [{ id: 2, title: 'E', steps: [{ id: 5, body: 'step', deadline: null }] }], items: [] };
  const desired = buildDesired([], unfinished, minimal);
  const first = await syncTasks(api, desired, twoWay(local));
  api.tasks[0].status = 'completed';
  const r = await syncTasks(api, desired, twoWay(local, first.snapshot));
  assert.deepEqual(local.calls, []);
  assert.equal(r.unchanged, 1);
});
