const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/ts/taskTimes.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod, mod.exports);
const { endTimeOf, lengthOf, endsNextDay, endChoices } = mod.exports;

test('end time from begin time and length', () => {
  assert.equal(endTimeOf('09:00', 30), '09:30');
  assert.equal(endTimeOf('09:45', 90), '11:15');
  assert.equal(endTimeOf('23:30', 60), '00:30');
  assert.equal(endTimeOf('', 60), '');
});

test('length from begin and end time', () => {
  assert.equal(lengthOf('09:00', '10:30'), 90);
  assert.equal(lengthOf('23:00', '01:00'), 120);
  assert.equal(lengthOf('09:00', '09:00'), null);
  assert.equal(lengthOf('', '09:00'), null);
  assert.equal(lengthOf('09:00', '09:00') === null, true);
  assert.equal(lengthOf('09:00', '09:05'), 5);
});

test('next day and choices', () => {
  assert.equal(endsNextDay('23:30', 60), true);
  assert.equal(endsNextDay('09:00', 60), false);
  assert.equal(endsNextDay('00:00', 1440), true);
  const quarters = ['09:00', '09:15'];
  assert.deepEqual(endChoices(quarters, '09:15'), quarters);
  assert.deepEqual(endChoices(quarters, '09:10'), ['09:00', '09:10', '09:15']);
});
