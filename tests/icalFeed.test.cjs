const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/ts/icalFeed.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports);
const { parseFeed, feedAddress } = mod.exports;

const wrap = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = lines => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const range = (a, b) => ({ from: new Date(a), to: new Date(b) });
const iso = e => [e.title, e.start.toISOString(), e.end.toISOString()];

test('address', () => {
  assert.equal(feedAddress(' webcal://x.org/a.ics '), 'https://x.org/a.ics');
  assert.equal(feedAddress('https://x.org/a.ics'), 'https://x.org/a.ics');
  assert.equal(feedAddress('ftp://x'), '');
  assert.equal(feedAddress('hello'), '');
});

test('a UTC event, with an end, and a folded line', () => {
  const text = wrap(ev(['UID:1', 'DTSTART:20261116T090000Z', 'DTEND:20261116T103000Z', 'SUMMARY:Lab\\, meeting', ' with more']));
  const events = parseFeed(text, range('2026-11-16T00:00:00Z', '2026-11-17T00:00:00Z'));
  assert.deepEqual(events.map(iso), [['Lab, meetingwith more', '2026-11-16T09:00:00.000Z', '2026-11-16T10:30:00.000Z']]);
});

test('events outside the range are left out', () => {
  const text = wrap(ev(['UID:1', 'DTSTART:20261201T090000Z', 'DTEND:20261201T100000Z', 'SUMMARY:Later']));
  assert.equal(parseFeed(text, range('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z')).length, 0);
});

test('a named time zone, summer and winter', () => {
  const winter = parseFeed(wrap(ev(['UID:w', 'DTSTART;TZID=Europe/Zurich:20261116T090000', 'DTEND;TZID=Europe/Zurich:20261116T100000', 'SUMMARY:W'])), range('2026-11-16T00:00:00Z', '2026-11-17T00:00:00Z'));
  assert.equal(winter[0].start.toISOString(), '2026-11-16T08:00:00.000Z');
  const summer = parseFeed(wrap(ev(['UID:s', 'DTSTART;TZID=Europe/Zurich:20260716T090000', 'DTEND;TZID=Europe/Zurich:20260716T100000', 'SUMMARY:S'])), range('2026-07-16T00:00:00Z', '2026-07-17T00:00:00Z'));
  assert.equal(summer[0].start.toISOString(), '2026-07-16T07:00:00.000Z');
  assert.equal(summer[0].end.getTime() - summer[0].start.getTime(), 3600000);
});

test('all-day events and a duration', () => {
  const text = wrap([
    ev(['UID:a', 'DTSTART;VALUE=DATE:20261116', 'SUMMARY:Day']),
    ev(['UID:b', 'DTSTART:20261116T100000Z', 'DURATION:PT45M', 'SUMMARY:Short']),
  ].join('\r\n'));
  const events = parseFeed(text, range('2026-11-15T00:00:00Z', '2026-11-18T00:00:00Z'));
  const day = events.find(e => e.title === 'Day');
  assert.equal(day.allDay, true);
  assert.equal(day.end.getTime() - day.start.getTime() >= 23 * 3600000, true);
  const short = events.find(e => e.title === 'Short');
  assert.equal(short.end.getTime() - short.start.getTime(), 45 * 60000);
});

test('weekly repeat with days, count, and an excluded day', () => {
  const text = wrap(ev(['UID:r', 'DTSTART:20261102T090000Z', 'DTEND:20261102T100000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6', 'EXDATE:20261111T090000Z', 'SUMMARY:Rep']));
  const events = parseFeed(text, range('2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z'));
  // Mon 2, Wed 4, Mon 9, Wed 11 (excluded), Mon 16, Wed 18
  assert.deepEqual(events.map(e => e.start.toISOString().slice(0, 10)), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-16', '2026-11-18']);
});

test('every second day until a date, daily', () => {
  const text = wrap(ev(['UID:d', 'DTSTART:20261101T080000Z', 'DTEND:20261101T083000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261108T235959Z', 'SUMMARY:D']));
  const events = parseFeed(text, range('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'));
  assert.deepEqual(events.map(e => e.start.getUTCDate()), [1, 3, 5, 7]);
});

test('monthly: the second Tuesday, the last day, and a day of the month', () => {
  const second = parseFeed(wrap(ev(['UID:m', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:M'])), range('2026-11-01T00:00:00Z', '2027-02-01T00:00:00Z'));
  assert.deepEqual(second.map(e => e.start.toISOString().slice(0, 10)), ['2026-11-10', '2026-12-08', '2027-01-12']);
  const last = parseFeed(wrap(ev(['UID:l', 'DTSTART:20261130T090000Z', 'DTEND:20261130T100000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', 'SUMMARY:L'])), range('2026-11-01T00:00:00Z', '2027-03-01T00:00:00Z'));
  assert.deepEqual(last.map(e => e.start.toISOString().slice(0, 10)), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  const day31 = parseFeed(wrap(ev(['UID:x', 'DTSTART:20261031T090000Z', 'DTEND:20261031T100000Z', 'RRULE:FREQ=MONTHLY', 'SUMMARY:X'])), range('2026-10-01T00:00:00Z', '2027-01-15T00:00:00Z'));
  assert.deepEqual(day31.map(e => e.start.toISOString().slice(0, 10)), ['2026-10-31', '2026-12-31']);
});

test('yearly and a changed occurrence', () => {
  const text = wrap([
    ev(['UID:y', 'DTSTART:20261116T090000Z', 'DTEND:20261116T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Weekly']),
    ev(['UID:y', 'RECURRENCE-ID:20261123T090000Z', 'DTSTART:20261123T140000Z', 'DTEND:20261123T150000Z', 'SUMMARY:Moved']),
  ].join('\r\n'));
  const events = parseFeed(text, range('2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z'));
  assert.deepEqual(events.map(e => [e.title, e.start.toISOString()]), [
    ['Weekly', '2026-11-16T09:00:00.000Z'],
    ['Moved', '2026-11-23T14:00:00.000Z'],
    ['Weekly', '2026-11-30T09:00:00.000Z'],
  ]);
  const yearly = parseFeed(wrap(ev(['UID:z', 'DTSTART;VALUE=DATE:20200301', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'])), range('2026-02-20T00:00:00Z', '2026-03-10T00:00:00Z'));
  assert.equal(yearly.length, 1);
});

test('cancelled and broken events are skipped', () => {
  const text = wrap([ev(['UID:c', 'DTSTART:20261116T090000Z', 'STATUS:CANCELLED', 'SUMMARY:No']), ev(['UID:b', 'DTSTART:nonsense', 'SUMMARY:Bad'])].join('\r\n'));
  assert.equal(parseFeed(text, range('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')).length, 0);
});
