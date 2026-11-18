const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/shortDue.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { shortDue } = mod.exports;

const now = new Date(2026, 10, 17, 12, 0, 0); // Tue 17 Nov 2026

test('today, tomorrow and yesterday get a word and the time', () => {
  assert.equal(shortDue('2026-11-17T17:00:00', 'en', now), 'Today 05:00 PM');
  assert.equal(shortDue('2026-11-18T09:00:00', 'en', now), 'Tomorrow 09:00 AM');
  assert.equal(shortDue('2026-11-16T11:00:00', 'en', now), 'Yesterday 11:00 AM');
});

test('within the coming week it is the weekday and the time', () => {
  assert.equal(shortDue('2026-11-20T15:00:00', 'en', now), 'Fri 03:00 PM');
});

test('further away it is the day and month, with the year when it is another year', () => {
  assert.equal(shortDue('2026-10-16T11:00:00', 'en', now), 'Oct 16');
  assert.equal(shortDue('2030-01-01T10:00:00', 'en', now), 'Jan 1, 2030');
});

test('a value that is not a date gives an empty label', () => {
  assert.equal(shortDue('nonsense', 'en', now), '');
});
