const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the sequence files of a list leave out the sequencing reads (x.read.fasta)', () => {
  const php = read('src/Models/AbstractEntity.php');
  assert.match(php, /real_name REGEXP :pattern AND real_name NOT REGEXP :reads ORDER BY id/);
  assert.match(php, /bindValue\(':reads', '\\\\\.read\\\\\.\(fasta\|fa\)\$'\)/);
  // the same expression, in JavaScript, must match reads and nothing else of the sequence files
  const reads = /\.read\.(fasta|fa)$/;
  for (const name of ['9TV6VD_1_1318.read.fasta', 'x.read.fa']) assert.ok(reads.test(name), name);
  for (const name of ['pCMV-GFP.gb', 'pCMV.fasta', 'p.dna', 'reader.fasta', 'x.1-of-2.ab1']) assert.ok(!reads.test(name), name);
});

test('the plasmid search of the sequence viewer shows one file per plasmid, the main (oldest) one', () => {
  const js = read('web/sequence-viewer/tool.js');
  assert.match(js, /const file = entry\.sequence_files\[0\];/);
  assert.doesNotMatch(js, /entry\.sequence_files\.forEach/);
});

test('saved sequencing files of the Align tab can be removed, after asking', () => {
  const js = read('web/sequence-viewer/align-tab.js');
  assert.match(js, /window\.confirm\('Remove ' \+ upload\.real_name \+ ' from this entry\?'\)/);
  assert.match(js, /method: 'DELETE'/);
  assert.match(js, /'\/uploads\/' \+ upload\.id/);
});

test('the Align tab shows the sequencing files inside the bubbles of the alignments, not as a list of ovals', () => {
  const js = read('web/sequence-viewer/align-tab.js');
  assert.doesNotMatch(js, /nameBox/);
  assert.doesNotMatch(js, /Sequencing files saved with this plasmid/);
  assert.match(js, /decorateCard = function \(box, name\)/);
  assert.match(js, /not aligned yet/);
  // a file taken out of the entry is not brought back by the saved alignment
  assert.match(js, /a file that was taken out of the entry since is not shown from the saved alignment/);
});

test('the Primers tab offers to attach the primers of the file that are in the database but not linked to the plasmid', () => {
  const js = read('web/sequence-viewer/primers-panel.js');
  assert.match(js, /const matchedOnly = \[\];/);
  assert.match(js, /In the database, not attached to this plasmid/);
  assert.match(js, /action\('Attach all ' \+ matchedOnly\.length/);
  assert.match(js, /tools\.attach\(entryId, item\.primer\.id\)/);
});
