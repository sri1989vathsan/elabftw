#!/usr/bin/env node
/**
 * Checks src/whats-new.json (the guide cards and the What's new entries).
 * Run from the repository root:  node tests/manual/guide-cards-check.js
 * Exit code 0 = all good, 1 = problems (listed).
 *
 * Checks: valid JSON, unique ids, required fields, summary / detail length limits and the number of details of the guide-* cards,
 * every image (and extra screenshot) exists and is small enough, every guide-* card has a picture and alt text, every card id used by
 * a guide-info button (templates, TypeScript and Svelte) exists and is a guide card, and every guide card is reachable: it has an i button, or it is in
 * an area opened by an area i, or it is listed as page-only (with the reason) in this file.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const MAX_SUMMARY = 140, MAX_DETAIL = 140, MIN_DETAILS = 3, MAX_DETAILS = 6, MAX_IMAGE_KB = 400;
const errors = [];
const warnings = [];
const fail = m => errors.push(m);

// src/whats-new.json is shared by all branches; src/whats-new-inventory.json exists only on the inventory branch (entries about the Database,
// storage, sequence editor and so on) and is read by the same loader (WhatsNewStore). When it exists its entries are checked as well.
let entries;
try {
  entries = JSON.parse(fs.readFileSync(path.join(root, 'src/whats-new.json'), 'utf8'));
  const inventoryFile = path.join(root, 'src/whats-new-inventory.json');
  if (fs.existsSync(inventoryFile)) entries = entries.concat(JSON.parse(fs.readFileSync(inventoryFile, 'utf8')));
} catch (e) {
  console.error('FAIL invalid JSON: ' + e.message);
  process.exit(1);
}
if (!Array.isArray(entries)) { console.error('FAIL the file is not a list of entries'); process.exit(1); }

const imageDir = path.join(root, 'web/assets/images/whats-new');
const len = s => [...s].length;
const ids = new Set();
const guideIds = new Set();
entries.forEach((e, i) => {
  const id = e.id;
  if (typeof id !== 'string' || id === '') { fail(`entry #${i} has no id`); return; }
  if (ids.has(id)) fail(`${id}: duplicate id`);
  ids.add(id);
  for (const field of ['date', 'area', 'title', 'summary', 'details']) {
    if (e[field] === undefined || e[field] === '' || (Array.isArray(e[field]) && e[field].length === 0)) fail(`${id}: missing ${field}`);
  }
  if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`${id}: date is not YYYY-MM-DD`);
  const isGuide = id.startsWith('guide-');
  if (isGuide) guideIds.add(id);
  if (isGuide && e.summary && len(e.summary) > MAX_SUMMARY) fail(`${id}: summary is ${len(e.summary)} characters (max ${MAX_SUMMARY})`);
  if (Array.isArray(e.details)) {
    const n = e.details.length;
    if (isGuide && (n < MIN_DETAILS || n > MAX_DETAILS)) fail(`${id}: ${n} details (want ${MIN_DETAILS}-${MAX_DETAILS})`);
    e.details.forEach((d, k) => {
      if (typeof d !== 'string') { fail(`${id}: detail #${k} is not text`); return; }
      const text = d.includes('::') ? d.split('::').slice(1).join('::') : d;
      if (isGuide && len(text) > MAX_DETAIL) fail(`${id}: detail #${k} is ${len(text)} characters (max ${MAX_DETAIL})`);
    });
  }
  const image = e.image || '';
  if (image) {
    const file = path.join(imageDir, image);
    if (!fs.existsSync(file)) fail(`${id}: image ${image} does not exist`);
    else if (fs.statSync(file).size > MAX_IMAGE_KB * 1024) fail(`${id}: image ${image} is ${Math.round(fs.statSync(file).size / 1024)} KB (max ${MAX_IMAGE_KB})`);
    if (!e.imageAlt) fail(`${id}: has an image but no imageAlt`);
  } else if (isGuide) {
    fail(`${id}: guide card without an image`);
  }
  for (const s of e.screenshots || []) {
    if (s.image && !fs.existsSync(path.join(imageDir, s.image))) fail(`${id}: extra screenshot ${s.image} does not exist`);
    else if (s.image && fs.statSync(path.join(imageDir, s.image)).size > MAX_IMAGE_KB * 1024) fail(`${id}: extra screenshot ${s.image} is over ${MAX_IMAGE_KB} KB`);
  }
  if (e.highlight) {
    for (const k of ['x', 'y', 'w', 'h']) if (typeof e.highlight[k] !== 'number') fail(`${id}: highlight.${k} missing`);
  }
});

// Card ids used by guide-info buttons: guide.info('id'), data-card='id', or any quoted 'guide-...' literal in templates, TypeScript, Svelte and
// the label dialog (a card chosen through a lookup, like the templates page, is written as a literal too).
const used = new Map();
const scan = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith(ext)).map(f => path.join(root, dir, f));
const files = [...scan('src/templates', '.html'), ...scan('src/ts', '.ts'), ...scan('src/ts/components', '.svelte'), ...scan('web', '.js'), ...scan('web', '.php')];
const areasLinked = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/guide\.info\(\s*'([^']+)'/g)) used.set(m[1], [...(used.get(m[1]) || []), path.basename(file)]);
  for (const m of text.matchAll(/data-card=['"]([a-z0-9-]+)['"]/g)) used.set(m[1], [...(used.get(m[1]) || []), path.basename(file)]);
  // (other 'guide-...' names such as the editor button 'guide-help' are not cards: only literals that are card ids count here)
  for (const m of text.matchAll(/['"](guide-[a-z0-9-]+)['"]/g)) if (ids.has(m[1])) used.set(m[1], [...(used.get(m[1]) || []), path.basename(file)]);
  for (const m of text.matchAll(/guide\.area\(\s*'([^']+)'/g)) areasLinked.add(m[1]);
}
// the label dialog (web/label-dialog.js) links to the whats-new page of the area "Others"
if (/whats-new\.php\?area=Others/.test(fs.readFileSync(path.join(root, 'web/label-dialog.js'), 'utf8'))) areasLinked.add('Others');
// area links written as a literal: href='whats-new.php?area=Database'
for (const file of files) for (const m of fs.readFileSync(file, 'utf8').matchAll(/whats-new\.php\?area=([A-Za-z]+)/g)) areasLinked.add(m[1]);
for (const [card, where] of used) {
  const names = [...new Set(where)].join(', ');
  if (!ids.has(card)) fail(`card id '${card}' used in ${names} does not exist in whats-new.json or whats-new-inventory.json`);
  else if (!guideIds.has(card)) fail(`card id '${card}' used in ${names} is not a guide-* entry`);
}
// Cards without an own i button must be reachable another way: through an area i (opens the guide page showing the whole area), or be listed
// here as page-only (they are still on the What's new / guide page). Keep the reason when you add one.
const PAGE_ONLY = {
  'guide-pins': 'the pin buttons sit in every list row; a small i there would clutter the rows. The Experiments area i lists the card too',
  'guide-reminders': 'the reminder chip is drawn by a Svelte component and the reminder field by the to-do panel script; an i there needs a TypeScript build',
};
const byId = new Map(entries.map(e => [e.id, e]));
for (const card of guideIds) {
  if (used.has(card)) continue;
  const area = byId.get(card).area;
  if (areasLinked.has(area)) continue;
  if (PAGE_ONLY[card]) continue;
  fail(`${card} has no i button, is not in an area opened by an area i (${[...areasLinked].join(', ')}) and is not listed as page-only`);
}
for (const card of Object.keys(PAGE_ONLY)) {
  if (!guideIds.has(card)) fail(`PAGE_ONLY lists ${card}, which is not a guide card`);
  else if (used.has(card)) fail(`${card} is listed as page-only but has an i button now: remove it from PAGE_ONLY`);
}

warnings.forEach(w => console.log('WARN ' + w));
if (errors.length) {
  errors.forEach(m => console.log('FAIL ' + m));
  console.log(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`OK ${entries.length} entries, ${guideIds.size} guide cards, ${used.size} card ids used by i buttons`);
