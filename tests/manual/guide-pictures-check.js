#!/usr/bin/env node
/**
 * Checks the pictures of the in-app guide (src/whats-new.json and, on the inventory branch, src/whats-new-inventory.json; web/assets/images/whats-new/).
 * Run from the repository root:  node tests/manual/guide-pictures-check.js
 * Exit code 0 = all good, 1 = problems (listed).
 *
 * Fails on:
 *  - an entry without a picture (except the ids in NO_PICTURE_OK below),
 *  - a missing picture file,
 *  - a picture file larger than 400 KB,
 *  - a picture narrower than 400 px (JPEG and PNG headers are read, no image library needed),
 *  - one picture (same file name, or identical bytes) used by two entries that are not about the same feature (SAME_FEATURE below),
 *  - a picture file in web/assets/images/whats-new/ that no entry references (as image or as an extra screenshot).
 * An entry with a picture must also have an imageAlt of at least 20 characters.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const imageDir = path.join(root, 'web/assets/images/whats-new');
const MAX_KB = 400;
const MIN_WIDTH = 400;

// Entries that are allowed to have no picture (nothing visible to show). Keep this list empty if possible.
const NO_PICTURE_OK = new Set([]);

// Groups of entry ids that describe the same feature and may therefore share one picture.
const SAME_FEATURE = [
  ['guide-calendar', 'activity-calendar'],
  ['guide-boards', 'boards', 'cards-linked-experiments', 'guide-collaboration'],
  ['guide-folder-views', 'folder-explorer'],
  ['guide-google-calendar', 'google-calendar-tasks'],
  ['guide-labels', 'print-label'],
  ['guide-print-pdf', 'print-pdf-match-sheet', 'print-pdf-selected-sections'],
  ['guide-reminders', 'reminder-chip'],
  ['guide-sidebar', 'left-sidebar', 'guide-todo'],
  ['guide-templates', 'template-version-history'],
  ['guide-whats-new-popup', 'whats-new-popup'],
  ['guide-list-layouts', 'list-layouts'],
  ['guide-dashboard', 'dashboard-tiles'],
  ['guide-create-entry', 'create-with-folder'],
  ['guide-orders', 'orders'],
  ['guide-database', 'database-guide'],
  ['guide-database-sharing', 'database-team-switches'],
  ['navigation', 'quick-links'],
  ['guide-steps', 'steps-and-tasks'],
  ['guide-toc', 'side-panel-refresh'],
  ['guide-todo-notifications', 'notifications-feedback'],
  ['guide-spreadsheets', 'spreadsheet-insert-and-view', 'spreadsheet-editing', 'spreadsheet-previews', 'sheet-frame-fits'],
];

const errors = [];
const fail = m => errors.push(m);

let entries;
try {
  entries = JSON.parse(fs.readFileSync(path.join(root, 'src/whats-new.json'), 'utf8'));
  // the inventory branch has a second file with its own entries (same loader): check those too when it exists
  const inventoryFile = path.join(root, 'src/whats-new-inventory.json');
  if (fs.existsSync(inventoryFile)) entries = entries.concat(JSON.parse(fs.readFileSync(inventoryFile, 'utf8')));
} catch (e) {
  console.error('FAIL invalid JSON: ' + e.message);
  process.exit(1);
}

/** Width of a JPEG or PNG without any library; null when the format is not recognised. */
function imageWidth(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 24 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return buf.readUInt32BE(16);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return buf.readUInt16BE(i + 7);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const sameFeature = (a, b) => SAME_FEATURE.some(g => g.includes(a) && g.includes(b));
const referenced = new Set();
const byName = new Map();
const byHash = new Map();

for (const e of entries) {
  const files = [];
  if (e.image) files.push(e.image);
  for (const s of e.screenshots || []) if (s.image) files.push(s.image);
  if (!e.image) {
    if (!NO_PICTURE_OK.has(e.id)) fail(`${e.id}: no picture`);
    continue;
  }
  if (!e.imageAlt || e.imageAlt.length < 20) fail(`${e.id}: imageAlt missing or too short`);
  for (const f of files) {
    referenced.add(f);
    const file = path.join(imageDir, f);
    if (!fs.existsSync(file)) { fail(`${e.id}: picture ${f} does not exist`); continue; }
    const size = fs.statSync(file).size;
    if (size > MAX_KB * 1024) fail(`${e.id}: ${f} is ${Math.round(size / 1024)} KB (max ${MAX_KB})`);
    const width = imageWidth(file);
    if (width === null) fail(`${e.id}: ${f} is not a readable JPEG or PNG`);
    else if (width < MIN_WIDTH) fail(`${e.id}: ${f} is only ${width} px wide (min ${MIN_WIDTH})`);
  }
  const main = path.join(imageDir, e.image);
  if (!fs.existsSync(main)) continue;
  const hash = crypto.createHash('md5').update(fs.readFileSync(main)).digest('hex');
  for (const [map, key, what] of [[byName, e.image, 'the same file'], [byHash, hash, 'identical pictures']]) {
    const other = map.get(key);
    if (other && !sameFeature(other, e.id)) fail(`${e.id} and ${other} use ${what} (${e.image}) but are not listed as the same feature`);
    if (!other) map.set(key, e.id);
  }
}

if (fs.existsSync(imageDir)) {
  for (const f of fs.readdirSync(imageDir)) {
    if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(f)) continue;
    if (!referenced.has(f)) fail(`${f} is not used by any entry`);
  }
}

if (errors.length) {
  errors.forEach(m => console.log('FAIL ' + m));
  console.log(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`OK ${entries.length} entries, ${referenced.size} picture files`);
