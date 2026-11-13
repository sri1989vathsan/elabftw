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

test('the import of a zip has a selectable primers option, off unless chosen, and the server reads it', () => {
  const js = read('web/planned.js');
  assert.match(js, /\['', 'Do nothing'\]/);
  assert.match(js, /form\.append\('primers', primersChoice\.value\);/);
  assert.match(js, /primersLabel\.hidden = !zipMode;/);
  const php = read('web/registry-transfer.php');
  assert.match(php, /in_array\(\(string\) \(\$source\['primers'\] \?\? ''\), array\('attach', 'create'\), true\)/);
  assert.match(php, /\$primerMode !== '' \? \$linkFilePrimers\(\$genbankFiles, \$primerMode\) : null/);
  // making missing primers happens only with the choice "create"
  assert.match(php, /if \(\$mode !== 'create' \|\| \$module === null\) \{\s*\$report\['missing'\]\+\+;/);
});


test('the JavaScript reader of the primers of a GenBank file reads what the PHP one reads', () => {
  const window = {};
  new Function('window', read('web/genbank-primers.js'))(window);
  const reader = window.GenbankPrimers;
  const sequence = 'ACGTTGCAAGGCTTAACCGGTTAAGCTTGGATCCAATTCGGCCATATGCGCGTAATACGA';
  const block = (i) => sequence.slice(i, i + 10).toLowerCase();
  const genbank = 'LOCUS       demo 60 bp DNA circular\nFEATURES             Location/Qualifiers\n'
    + '     source          1..60\n                     /organism="synthetic"\n'
    + '     primer_bind     5..20\n                     /label="fwd demo"\n                     /note="not used, label wins"\n'
    + '     primer_bind     complement(31..48)\n                     /note="rev demo"\n'
    + '     primer_bind     join(1..5,55..60)\n                     /label="split"\n'
    + '     primer_bind     <50..>58\n                     /standard_name="long\n                     name"\n'
    + '     primer_bind     complement(\n                     10..22)\n'
    + '     CDS             1..30\n                     /label="not a primer"\n'
    + 'ORIGIN\n        1 ' + [0, 10, 20, 30, 40, 50].map(block).join(' ') + '\n//\n';
  const primers = reader.read(genbank);
  assert.equal(primers.length, 4);
  assert.equal(primers[0].bases, sequence.slice(4, 20));
  assert.equal(primers[0].name, 'fwd demo');
  assert.equal(primers[1].bases, reader.reverseComplement(sequence.slice(30, 48)));
  assert.equal(primers[1].forward, false);
  assert.equal(primers[1].name, 'rev demo');
  assert.deepEqual([primers[2].start, primers[2].end, primers[2].name], [50, 58, 'long name']);
  assert.deepEqual([primers[3].start, primers[3].end, primers[3].forward], [10, 22, false]);
  assert.equal(reader.key(sequence.slice(4, 20)), reader.key(reader.reverseComplement(sequence.slice(4, 20))));
  assert.notEqual(reader.key(sequence.slice(4, 20)), reader.key(sequence.slice(30, 48)));
  assert.deepEqual(reader.read('LOCUS x\nORIGIN\n        1 acgt\n//\n'), []);
  assert.equal(reader.reverseComplement('ACGTRYKM'), 'KMRYACGT');
});

test('a plasmid that gets its sequence from a GenBank file is offered its primers: new entry, edit page, drop on the list', () => {
  const js = read('web/sequence-add.js');
  assert.match(js, /async function offerPrimers\(items\)/);
  assert.match(js, /const GENBANK_FILE = \/\\\.\(gb\|gbk\|gbff\|genbank\)\$\/i;/);
  // the new-entry dialog and the edit page ask after the upload, before they leave the page
  assert.match(js, /await offerPrimers\(\[\{ entry: id, title: title, file: sequenceFile \}\]\);/);
  assert.match(js, /await offerPrimers\(\[\{ entry: entryId, title: title, file: file \}\]\);/);
  // files dropped on the list: one question for all the GenBank files
  assert.match(js, /if \(withPrimers\.length > 0\) \{\s*await offerPrimers\(withPrimers\);/);
  // nothing is made unless the user picks the button that says so; "Not now" is there
  assert.match(js, /button\('Not now', 'btn-secondary', close\)/);
  assert.match(js, /run\(true\)/);
  assert.match(js, /tools\.createPrimer\(title, row\.bases, row\.forward, row\.plasmid, row\.entry\)/);
  // a failure to read the file never stops the upload
  assert.match(js, /The primers of the file could not be read/);
  const compose = read('docker-compose.inventory.yml');
  assert.match(compose, /\.\/web\/genbank-primers\.js:\/elabftw\/web\/genbank-primers\.js:ro/);
});

test('a sequence file can be dropped on the dialog of a new entry, which stays opaque while it is dragged over', () => {
  const js = read('web/sequence-add.js');
  assert.match(js, /backdrop\.addEventListener\('drop', function \(event\)/);
  // the drop stops at the dialog: the list behind it would make one entry per file
  assert.match(js, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*dialog\.classList\.remove\('sa-drop-target'\);/);
  assert.match(js, /radios\.file\.checked = true;\s*showChoice\(\);/);
  assert.match(js, /is not a sequence file \(GenBank, FASTA or SnapGene\)/);
  const css = read('web/sequence-add.css');
  // the general drop tint is see-through: on the dialog it would replace the white of the popup
  assert.match(css, /\.sa-dialog\.sa-drop-target \{[^}]*, #fff;/);
});
