const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/ts/back-to-link.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, URL, Date, Math, Array, JSON, window: {}, document: {},
  require: () => ({ default: { t: key => key } }),
});
const { withoutHash, isFollowableLink, placesForPage, leadsToAnotherPlace } = mod.exports;

const page = 'https://elab.test/experiments.php?mode=view&id=5#top';
const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

test('the hash is ignored when comparing pages', () => {
  assert.equal(withoutHash(page, page), 'https://elab.test/experiments.php?mode=view&id=5');
  assert.equal(withoutHash('database.php?mode=view&id=9#x', page), 'https://elab.test/database.php?mode=view&id=9');
});

test('links to other entries and to places in the same page leave a place to come back to', () => {
  assert.equal(isFollowableLink({ href: 'https://elab.test/database.php?mode=view&id=9' }, page, plain), true);
  assert.equal(isFollowableLink({ href: 'https://elab.test/experiments.php?mode=view&id=5#methods' }, page, plain), true);
});

test('links that do not navigate in this tab are ignored', () => {
  assert.equal(isFollowableLink({ href: 'https://elab.test/experiments.php?mode=view&id=5' }, page, plain), false, 'bare same-page link');
  assert.equal(isFollowableLink({ href: 'https://other.example/x' }, page, plain), false, 'other site');
  assert.equal(isFollowableLink({ href: 'https://elab.test/a', target: '_blank' }, page, plain), false);
  assert.equal(isFollowableLink({ href: 'https://elab.test/a' }, page, { ...plain, ctrlKey: true }), false);
  assert.equal(isFollowableLink({ href: 'https://elab.test/a' }, page, { ...plain, button: 1 }), false);
  assert.equal(isFollowableLink({ href: 'mailto:a@b.c' }, page, plain), false);
  assert.equal(isFollowableLink({ href: 'https://elab.test/a', hasAttribute: n => n === 'download' }, page, plain), false);
});

const place = (target, at = 1000, extra = {}) => ({ url: 'https://elab.test/experiments.php?mode=view&id=5', y: 300, label: 'E', target, at, ...extra });

test('the button is offered only on the page the last link led to', () => {
  const stack = [place('https://elab.test/database.php?mode=view&id=9')];
  assert.equal(placesForPage(stack, 'https://elab.test/database.php?mode=view&id=9#a', 2000).length, 1);
  assert.equal(placesForPage(stack, 'https://elab.test/dashboard.php', 2000).length, 0, 'an unrelated page drops everything');
});

test('a chain of links keeps every place, newest last', () => {
  const b = 'https://elab.test/database.php?mode=view&id=9';
  const c = 'https://elab.test/database.php?mode=view&id=10';
  const stack = [place(b, 1000), place(c, 1500, { url: b })];
  assert.equal(placesForPage(stack, c, 2000).length, 2);
});

test('old places are dropped', () => {
  const stack = [place('https://elab.test/x', 1000)];
  assert.equal(placesForPage(stack, 'https://elab.test/x', 1000 + 7 * 60 * 60 * 1000).length, 0);
});

test('only links that go to another page, another entry or another place in the page count', () => {
  const list = 'https://elab.test/experiments.php?mode=show&offset=0';
  assert.equal(leadsToAnotherPlace('experiments.php?mode=show&offset=15', list), false, 'paging');
  assert.equal(leadsToAnotherPlace('experiments.php?mode=view&id=7', list), true, 'an entry');
  assert.equal(leadsToAnotherPlace('projectmanagement.php', list), true, 'another page');
  assert.equal(leadsToAnotherPlace('experiments.php?mode=view&id=7', 'https://elab.test/experiments.php?mode=view&id=7'), false);
  assert.equal(leadsToAnotherPlace('experiments.php?mode=view&id=7#methods', 'https://elab.test/experiments.php?mode=view&id=7'), true);
});
