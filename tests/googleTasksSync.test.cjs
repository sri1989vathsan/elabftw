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
  module: mod, exports: mod.exports, Date, Math, Array, Map, Set, String, Object, JSON,
});
const { buildDesired, syncTasks, keyOf, localDate } = mod.exports;

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
