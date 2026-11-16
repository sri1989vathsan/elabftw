const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/googleCalendarSync.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Math, Array, Map, Set, String, Object, JSON, Number });
const { syncCalendar, eventBody, shownEvents, MARKER, DONE_PREFIX } = mod.exports;

// objects made inside the sandbox of the module are compared as plain data
const json = value => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-11-16T08:00:00Z');
const RANGE = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2027-05-01T00:00:00Z') };
const todo = (id, extra = {}) => ({ id, body: `Task ${id}`, deadline: '2026-11-20T10:00:00Z', duration_minutes: 45, reminder_minutes: 60, ...extra });

// a mock calendar that behaves like the part of Google Calendar that is used
function mockCalendar(initial = []) {
  const events = initial.map((e, i) => ({ id: `e${i}`, status: 'confirmed', ...e }));
  let next = events.length;
  const calls = [];
  return {
    events,
    calls,
    async listEvents() { return events.filter(e => e.status !== 'cancelled').map(e => JSON.parse(JSON.stringify(e))); },
    async insertEvent(body) {
      calls.push('insert');
      const e = { id: `e${next++}`, status: 'confirmed', ...JSON.parse(JSON.stringify(body)) };
      events.push(e);
      return e;
    },
    async patchEvent(id, patch) {
      calls.push('patch');
      const e = events.find(x => x.id === id);
      for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(patch)))) {
        if (k === 'extendedProperties') { e.extendedProperties = { private: { ...(e.extendedProperties?.private ?? {}), ...v.private } }; } else { e[k] = v; }
      }
    },
  };
}

function mockLocal() {
  const calls = [];
  return {
    calls,
    async createTodo(t) { calls.push(['create', t]); return 900 + calls.length; },
    async updateTodo(id, patch) { calls.push(['update', id, patch]); },
  };
}

const opts = (extra = {}) => ({ local: mockLocal(), snapshot: {}, twoWay: true, importEvents: false, includeDetails: false, origin: 'https://lab.example', range: RANGE, now: NOW, ...extra });

test('a task becomes an event that starts at the deadline and lasts its duration, with its reminder and its marker', async () => {
  const api = mockCalendar();
  const result = await syncCalendar(api, [todo(1)], opts());
  assert.equal(result.created, 1);
  const e = api.events[0];
  assert.equal(e.summary, 'Task 1');
  assert.equal(e.start.dateTime, '2026-11-20T10:00:00.000Z');
  assert.equal(e.end.dateTime, '2026-11-20T10:45:00.000Z');
  assert.deepEqual(e.reminders.overrides, [{ method: 'popup', minutes: 60 }]);
  assert.equal(e.extendedProperties.private[MARKER], '1');
  assert.match(e.description, /projectmanagement\.php\?task=1$/);
});

test('a task without a duration lasts 30 minutes, and without a reminder the event has none of its own', async () => {
  const api = mockCalendar();
  await syncCalendar(api, [todo(2, { duration_minutes: null, reminder_minutes: null })], opts());
  assert.equal(api.events[0].end.dateTime, '2026-11-20T10:30:00.000Z');
  assert.equal(api.events[0].reminders, undefined);
});

test('a second run with nothing changed writes nothing', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.calls.length = 0;
  const second = await syncCalendar(api, [todo(1)], opts({ snapshot: first.snapshot }));
  assert.deepEqual(api.calls, []);
  assert.equal(second.created + second.updated + second.pulled, 0);
});

test('a change of the deadline or the duration in eLabFTW is written to the event', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  const second = await syncCalendar(api, [todo(1, { duration_minutes: 90, deadline: '2026-11-21T09:00:00Z' })], opts({ snapshot: first.snapshot }));
  assert.equal(second.updated, 1);
  assert.equal(api.events[0].start.dateTime, '2026-11-21T09:00:00.000Z');
  assert.equal(api.events[0].end.dateTime, '2026-11-21T10:30:00.000Z');
});

test('an event moved or made longer in Google changes the task (two-way)', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.events[0].start.dateTime = '2026-11-20T14:00:00.000Z';
  api.events[0].end.dateTime = '2026-11-20T16:00:00.000Z';
  const local = mockLocal();
  const second = await syncCalendar(api, [todo(1)], opts({ snapshot: first.snapshot, local }));
  assert.equal(second.pulled, 1);
  assert.deepEqual(json(local.calls), [['update', 1, { deadline: '2026-11-20T14:00:00.000Z', duration_minutes: 120 }]]);
  assert.equal(second.snapshot['1'].start, new Date('2026-11-20T14:00:00Z').getTime());
});

test('a title changed in Google comes back, and a tick in front of it does not', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.events[0].summary = 'Renamed';
  const local = mockLocal();
  await syncCalendar(api, [todo(1)], opts({ snapshot: first.snapshot, local }));
  assert.deepEqual(json(local.calls), [['update', 1, { title: 'Renamed' }]]);
});

test('without two-way nothing comes back from Google', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.events[0].summary = 'Renamed';
  const local = mockLocal();
  const second = await syncCalendar(api, [todo(1)], opts({ snapshot: first.snapshot, local, twoWay: false }));
  assert.deepEqual(local.calls, []);
  assert.equal(second.pulled, 0);
});

test('when both sides changed, eLabFTW wins', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.events[0].summary = 'Changed in Google';
  const local = mockLocal();
  const second = await syncCalendar(api, [todo(1, { body: 'Changed here' })], opts({ snapshot: first.snapshot, local }));
  assert.equal(api.events[0].summary, 'Changed here');
  assert.deepEqual(local.calls, []);
  assert.equal(second.updated, 1);
});

test('an event deleted in Google is not made again, until the task changes', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  api.events[0].status = 'cancelled';
  const second = await syncCalendar(api, [todo(1)], opts({ snapshot: first.snapshot }));
  assert.equal(second.snapshot['1'].removed, true);
  assert.equal(api.events.length, 1);
  const third = await syncCalendar(api, [todo(1)], opts({ snapshot: second.snapshot }));
  assert.equal(third.created, 0);
  const fourth = await syncCalendar(api, [todo(1, { duration_minutes: 60 })], opts({ snapshot: third.snapshot }));
  assert.equal(fourth.created, 1);
});

test('a task that is done gets a tick in front of its event, once, and the event is kept', async () => {
  const api = mockCalendar();
  const first = await syncCalendar(api, [todo(1)], opts());
  const second = await syncCalendar(api, [], opts({ snapshot: first.snapshot }));
  assert.equal(second.completed, 1);
  assert.equal(api.events[0].summary, DONE_PREFIX + 'Task 1');
  api.calls.length = 0;
  const third = await syncCalendar(api, [], opts({ snapshot: second.snapshot }));
  assert.deepEqual(api.calls, []);
  assert.equal(third.completed, 0);
});

test('a task outside of the days that are looked at is left alone', async () => {
  const api = mockCalendar();
  const result = await syncCalendar(api, [todo(1, { deadline: '2030-01-01T10:00:00Z' })], opts());
  assert.equal(result.created, 0);
  assert.equal(api.events.length, 0);
});

test('new events of the calendar become to-dos when asked, once, and are marked', async () => {
  const api = mockCalendar([
    { summary: 'Lab meeting', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:30:00Z' } },
    { summary: 'Past', start: { dateTime: '2026-11-10T13:00:00Z' }, end: { dateTime: '2026-11-10T14:00:00Z' } },
    { summary: 'All day', start: { date: '2026-11-19' }, end: { date: '2026-11-20' } },
    { summary: 'Weekly', recurringEventId: 'r', start: { dateTime: '2026-11-19T13:00:00Z' }, end: { dateTime: '2026-11-19T14:00:00Z' } },
  ]);
  const local = mockLocal();
  const first = await syncCalendar(api, [], opts({ local, importEvents: true }));
  assert.equal(first.imported, 1);
  assert.deepEqual(json(local.calls), [['create', { title: 'Lab meeting', deadline: '2026-11-18T13:00:00.000Z', duration_minutes: 90 }]]);
  assert.equal(api.events[0].extendedProperties.private[MARKER], '901');
  const again = mockLocal();
  const second = await syncCalendar(api, [{ id: 901, body: 'Lab meeting', deadline: '2026-11-18T13:00:00Z', duration_minutes: 90 }], opts({ local: again, importEvents: true, snapshot: first.snapshot }));
  assert.equal(second.imported, 0);
  assert.deepEqual(again.calls, []);
});

test('events of other types (birthdays, mail, focus time) are not brought in', async () => {
  const api = mockCalendar([
    { summary: 'Birthday', eventType: 'birthday', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } },
    { summary: 'Focus', eventType: 'focusTime', start: { dateTime: '2026-11-18T15:00:00Z' }, end: { dateTime: '2026-11-18T16:00:00Z' } },
    { summary: 'Normal', eventType: 'default', start: { dateTime: '2026-11-18T17:00:00Z' }, end: { dateTime: '2026-11-18T18:00:00Z' } },
  ]);
  const local = mockLocal();
  const result = await syncCalendar(api, [], opts({ local, importEvents: true }));
  assert.equal(result.imported, 1);
  assert.deepEqual(json(local.calls.map(call => call[1].title)), ['Normal']);
});

test('when Google refuses to mark an imported event the run goes on, and the event is not brought in again', async () => {
  const api = mockCalendar([{ summary: 'Odd one', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } }]);
  const refuse = async () => { throw new Error('Google Calendar said 400.'); };
  const first = await syncCalendar({ ...api, patchEvent: refuse }, [], opts({ local: mockLocal(), importEvents: true }));
  assert.equal(first.imported, 1);
  assert.equal(first.unmarked, 1);
  assert.deepEqual(Object.keys(json(first.snapshot)), ['901']);
  const again = mockLocal();
  const second = await syncCalendar(api, [{ id: 901, body: 'Odd one', deadline: '2026-11-18T13:00:00Z', duration_minutes: 60 }], opts({ local: again, importEvents: true, snapshot: first.snapshot }));
  assert.equal(second.imported, 0);
  assert.deepEqual(again.calls, []);
  assert.deepEqual(api.calls, []);
});

test('events are not brought in without the box, or in one-way', async () => {
  const events = [{ summary: 'Lab meeting', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } }];
  const local = mockLocal();
  await syncCalendar(mockCalendar(events), [], opts({ local, importEvents: false }));
  await syncCalendar(mockCalendar(events), [], opts({ local, importEvents: true, twoWay: false }));
  assert.deepEqual(local.calls, []);
});

test('the calendar page shows the events of a calendar but not the ones that are tasks', () => {
  const calendar = { id: 'lab', summary: 'Lab', color: '#0b8043', writable: false, primary: false };
  const list = shownEvents(calendar, [
    { id: 'a', summary: 'Seminar', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } },
    { id: 'b', summary: 'A task', extendedProperties: { private: { [MARKER]: '4' } }, start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } },
    { id: 'c', summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-11-18T13:00:00Z' }, end: { dateTime: '2026-11-18T14:00:00Z' } },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Seminar');
  assert.equal(list[0].source, 'Lab');
  assert.equal(list[0].calendar, 'lab');
  assert.equal(list[0].color, '#0b8043');
});

test('the notes are sent only when asked', () => {
  const t = todo(5, { notes: '<p>Bring <b>samples</b></p>' });
  assert.doesNotMatch(eventBody(t, { origin: 'https://x', includeDetails: false }).description, /samples/);
  assert.match(eventBody(t, { origin: 'https://x', includeDetails: true }).description, /^Bring samples/);
});
