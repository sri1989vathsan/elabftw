const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('migration 108 adds both settings, off by default, and the runner lists it', () => {
  const sql = read('src/sql/custom/108_google_tasks_admin_setting.sql');
  assert.match(sql, /INSERT IGNORE INTO `config`/);
  assert.match(sql, /\('google_tasks_enabled', '0'\)/);
  assert.match(sql, /\('google_tasks_client_id', ''\)/);
  assert.match(read('src/Elabftw/CustomMigrationRunner.php'), /'108_google_tasks_admin_setting\.sql'/);
});

test('the to-do panel only renders the sync row when the administrator switched it on', () => {
  const html = read('src/templates/todolist-panel.html');
  const guarded = /\{% if App\.Config\.configArr\.google_tasks_enabled\|default\('0'\) == '1' %\}\s*<div id='googleSyncRow'[^>]*data-client-id='[^']*'[^>]*><\/div>\s*\{% endif %\}/;
  assert.match(html, guarded);
  assert.equal(html.match(/id='googleSyncRow'/g).length, 1);
  // under the list component, which ends with the calendar link section
  assert.ok(html.indexOf("id='googleSyncRow'") > html.indexOf("id='todolist'"));
});

test('the admin page offers the switch and the client ID', () => {
  const html = read('src/templates/sysconfig.html');
  assert.match(html, /'slug': 'google_tasks_enabled'/);
  assert.match(html, /data-target='google_tasks_client_id'/);
});

test('the browser code prefers the administrator client ID and hides the box then', () => {
  const src = read('src/ts/googleSync.ts');
  assert.match(src, /return adminClientId\(\) \|\| read\(KEY_CLIENT\);/);
  assert.equal((src.match(/read\(KEY_CLIENT\)/g) || []).length, 1); // only the helper reads the browser's own value
  assert.match(src, /if \(adminClientId\(\) === ''\) \{\s*body\.appendChild\(input\);/);
});
