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
  assert.match(js, /element\('button', 'btn btn-secondary', 'Not now'\)/);
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

test('a GenBank file gives the name and the resistance of the plasmid (JavaScript reader)', () => {
  const window = {};
  new Function('window', read('web/genbank-primers.js'))(window);
  const reader = window.GenbankPrimers;
  const file = 'LOCUS       pTEST_1            2686 bp ds-DNA     circular SYN 01-JAN-2000\nDEFINITION  A test\n            plasmid.\nFEATURES             Location/Qualifiers\n     source          1..2686\n     CDS             complement(100..960)\n                     /label="AmpR"\n     promoter        1000..1100\n                     /label="AmpR promoter"\nORIGIN\n        1 acgt\n//\n';
  assert.deepEqual(reader.summary(file), { name: 'pTEST_1', length: 2686, topology: 'circular', definition: 'A test plasmid', resistance: 'Ampicillin', resistanceFrom: 'AmpR' });
  // a generic name is not a name; two antibiotics are not guessed
  const two = 'LOCUS       Untitled 10 bp DNA linear\nFEATURES             Location/Qualifiers\n     CDS 1..9\n                     /gene="bla"\n     CDS 1..9\n                     /label="KanR"\nORIGIN\n 1 acgtacgtac\n//';
  const said = reader.summary(two);
  assert.equal(said.name, '');
  assert.equal(said.resistance, '');
  // the primers are read as before
  assert.equal(reader.read(file).length, 0);
});

test('dropping or choosing a GenBank file fills the name and the fields; the import dialog takes dropped files', () => {
  const js = read('web/sequence-add.js');
  assert.match(js, /async function summaryOf\(file\)/);
  assert.match(js, /async function applyDetails\(entryId, details\)/);
  // the dialog: name filled unless typed, a message tells what was read
  assert.match(js, /if \(details\.name && \(name\.value\.trim\(\) === '' \|\| nameFromFile\)\)/);
  assert.match(js, /fillFromFile\(dropped\);/);
  assert.match(js, /file\.addEventListener\('change', function \(\) \{\s*if \(file\.files && file\.files\[0\]\) \{\s*fillFromFile/);
  // creating: the name of the file's LOCUS line before the name of the file, and the fields filled after the upload
  assert.match(js, /title = \(found && found\.name\) \|\| sequenceFile\.name/);
  assert.match(js, /await applyDetails\(id, await summaryOf\(sequenceFile\)\);/);
  // one function adds files to a module: the drop on the list and the import dialog use it
  assert.match(js, /async function addFiles\(files, entry, category, register\)/);
  assert.match(js, /await addFiles\(files, entry, category\);/);
  assert.match(js, /window\.SequenceAdd = \{ addFiles:/);
  const planned = read('web/planned.js');
  assert.match(planned, /back\.addEventListener\('drop', function \(event\)/);
  assert.match(planned, /useSequences\(sequences\.slice\(0, 50\)\);/);
  // the dialog keeps its own background while a file is over it (an outline only)
  assert.match(planned, /box\.style\.outline = on \? '2px dashed #5b8def' : '';/);
  assert.doesNotMatch(planned, /box\.style\.background/);
});

test('sequence files dropped on the import dialog wait for "Where the entries go", and a single new entry is opened', () => {
  const planned = read('web/planned.js');
  // the drop chooses the files, it does not import them
  assert.match(planned, /useSequences\(sequences\.slice\(0, 50\)\);/);
  assert.doesNotMatch(planned, /back\.remove\(\);\s*window\.SequenceAdd\.addFiles\(category, sequences/);
  // Import takes the destination of the dialog: the lab database, My database, or no number yet
  assert.match(planned, /window\.SequenceAdd\.addFiles\(category, chosen, destination\.value\);/);
  // the lab database is possible for these (the file is the sequence) even in a module that needs a sequence file
  assert.match(planned, /option\.disabled = !on;/);
  // the lab database comes first and is the start; "Both" (the lab and My database) is an option of its own
  assert.match(planned, /\[\['lab', 'The lab database[^\]]*\], \['both', 'Both: the lab database, and My database[^\]]*\], \['personal'/);
  assert.match(planned, /destination\.value = 'lab';/);
  // the import of a csv/zip knows the destination 'lab' (the lab database only) next to 'both'
  const transfer = read('web/registry-transfer.php');
  assert.match(transfer, /array\('both', 'lab', 'personal', 'none'\)/);
  assert.match(transfer, /\$inLab = \$register === 'lab' \|\| \$register === 'both';/);
  assert.match(transfer, /\$Entry->asUnregistered = !\$inLab;/);
  // choosing a csv or a zip leaves the sequence mode
  assert.match(planned, /file\.addEventListener\('change', async function \(\) \{\s*setSequenceMode\(false\);/);
  // the label with d-block would show although it is hidden: the stylesheet says hidden wins, and has a version in its address
  assert.match(read('web/planned.css'), /\.planned-dialog \[hidden\] \{\s*display: none !important;/);
  assert.match(planned, /link\.href = 'planned\.css\?v=' \+ Math\.floor\(Date\.now\(\) \/ 3600000\);/);
  const js = read('web/sequence-add.js');
  assert.match(js, /async function addFiles\(files, entry, category, register\)/);
  assert.match(js, /createEntry\(category, named, where\)/);
  // one new entry made without a failure is opened, like the dialog of a new entry; else a message says where they are, and stays long enough
  assert.match(js, /window\.location\.href = 'registry\.php\?mode=edit&id=' \+ made\[0\];/);
  assert.match(js, /in My entries, in your own database \(private\)/);
  assert.match(js, /failed\.length > 0, 10\);/);
});

test('the primers that are made go where the user chooses: My entries, the lab database or both', () => {
  const tools = read('web/primer-tools.js');
  assert.match(tools, /register: destination\(\)/);
  // the lab database is the first choice and the start; the list has room for its arrow
  assert.match(tools, /\['lab', 'The lab database[^\]]*\], \['both', 'Both[^\]]*\], \['personal', 'My database[^\]]*\], \['none', 'My entries/);
  assert.match(tools, /: 'lab';\s*\} catch \(error\) \{\s*return 'lab';/);
  assert.match(tools, /select\.style\.padding = '0\.2rem 2rem 0\.2rem 0\.5rem';/);
  // a primer that is only in My entries goes into the lab database with the lab choices, not with My database
  assert.match(tools, /return destination\(\) === 'lab' \|\| destination\(\) === 'both';/);
  assert.match(read('web/sequence-add.js'), /tools\.registerInLab\(id\)/);
  assert.match(tools, /destinationControl: destinationControl,/);
  assert.match(read('web/sequence-add.js'), /const where = tools\.destinationControl\(\);[\s\S]*dialog\.append\(bar, list, where, message, actions\);/);
  assert.match(read('web/sequence-viewer/primers-panel.js'), /tools\.destinationControl\(\)/);
});

test('primers written as the feature "primer" (ApE, SnapGene) are read, with the oligo of the note as the primer', () => {
  const window = {};
  new Function('window', read('web/genbank-primers.js'))(window);
  const reader = window.GenbankPrimers;
  const sequence = 'ACGTTGCAAGGCTTAACCGGTTAAGCTTGGATCCAATTCGGCCATATGCGCGTAATACGA';
  const file = 'LOCUS       ape 60 bp DNA circular\nFEATURES             Location/Qualifiers\n'
    + '     primer          5..20\n                     /label="ape fwd"\n                     /note="sequence: ' + sequence.slice(4, 20).toLowerCase() + '"\n'
    + '     primer          complement(31..48)\n                     /label="ape rev"\n                     /note="sequence: TTTT' + sequence.slice(30, 48) + '"\n'
    + '     primer          50..58\n                     /label="too short"\n'
    + '     CDS             1..30\n                     /label="AmpR"\n'
    + 'ORIGIN\n        1 ' + sequence.toLowerCase() + '\n//\n';
  const primers = reader.read(file);
  // the third is 9 bases: read, and left out later by the minimum length
  assert.equal(primers.length, 3);
  assert.equal(primers[0].bases, sequence.slice(4, 20));
  assert.equal(primers[0].name, 'ape fwd');
  // the note is the oligo as ordered, tail included
  assert.equal(primers[1].bases, 'TTTT' + sequence.slice(30, 48));
  assert.equal(primers[1].forward, false);
  // a primer called AmpR would not make the resistance
  const named = 'LOCUS       x 20 bp DNA circular\nFEATURES             Location/Qualifiers\n     primer          1..10\n                     /label="AmpR-F"\nORIGIN\n        1 acgtacgtacgtacgtacgt\n//\n';
  assert.equal(reader.summary(named).resistance, '');
});

test('the primers dialog lists every primer of the file with a box, and only the ticked ones are added and attached', () => {
  const js = read('web/sequence-add.js');
  assert.match(js, /row\.picked = !row\.several;/);
  assert.match(js, /box\.type = 'checkbox';/);
  assert.match(js, /\['Tick all', true\], \['Tick none', false\]/);
  // what is ticked decides: nothing ticked, nothing to do
  assert.match(js, /'Nothing is ticked'/);
  assert.match(js, /rows\.filter\(function \(item\) \{\s*return item\.picked && !item\.several;/);
  // a primer that is not in the database is added when it is ticked, one that is there is only attached
  assert.match(js, /if \(id === null\) \{\s*id = made\.get\(row\.key\) \|\| null;/);
  assert.match(js, /await tools\.attach\(row\.entry, id\);/);
  // the ones that match several primers of the database are not ticked and cannot be ticked
  assert.match(js, /box\.disabled = row\.several;/);
  const php = read('web/sequence-viewer/genbank-primers.inc.php');
  assert.match(php, /array\('primer_bind', 'primer'\)/);
});

test('several sequence files dropped on the new entry dialog make one entry each', () => {
  const js = read('web/sequence-add.js');
  assert.match(js, /if \(sequences\.length > 1\) \{\s*close\(\);\s*addFiles\(sequences\.slice\(0, 50\), 0, categoryId, 'both'\);/);
  assert.doesNotMatch(js, /the others were left out/);
});

test('ordering primers from the editor attaches the order sheet only: the primers are not linked to the order as chips', () => {
  assert.match(read('web/primer-tools.js'), /action: 'order', primers: primerIds, order: orderId, link: false/);
  assert.match(read('web/primers.php'), /\$linkPrimers = \(\$payload\['link'\] \?\? true\) !== false;/);
});

test('an item ordered from the database (an antibody, a reagent) is not linked to the order: no chip with its name', () => {
  const planned = read('web/planned.js');
  assert.doesNotMatch(planned, /action: 'order', primers: \[entry\.id\]/);
  assert.match(planned, /the entry is not linked to the order: the order has no chip/);
});

test('the files attached to an order are a soft card with the icon of their kind, and the sheet button says what it does', () => {
  const js = read('web/order-primers.js');
  assert.match(js, /li\.orders-upload\.op-row \{/);
  assert.match(js, /\['fa-file-excel'|'fa-file-excel'/);
  assert.match(js, /document\.createTextNode\('Add to database'\)/);
  assert.doesNotMatch(js, /fa-plus/);
});

test('each order says what kind it is and has a button to add it to the database', () => {
  const js = read('web/order-to-database.js');
  assert.match(js, /const NOUNS = \{ Primers: 'primers', Antibodies: 'antibody'/);
  assert.match(js, /document\.createTextNode\('Add ' \+ \(NOUNS\[kind\] \|\| 'entry'\) \+ ' to database'\)/);
  // the oligos are told by the title or by a sheet of oligos; the sheet of oligos has its own window
  assert.match(js, /oligos\?\|primers\?/);
  assert.match(js, /card\.querySelector\('\.op-add'\)/);
  assert.match(js, /open\(\{ orderId: orderId \}\);/);
});

test('the window of the primers of an order sheet says what it does, and links nothing to the order', () => {
  const js = read('web/order-primers.js');
  assert.match(js, /'Nothing new to add'/);
  assert.match(js, /' new ' \+ \(fresh === 1 \? 'primer' : 'primers'\) \+ ' to the database'/);
  assert.doesNotMatch(js, /to the order'/);
  assert.doesNotMatch(js, /action: 'order'/);
  assert.match(js, /tools\.destinationControl\(\)/);
});

test('the details of a vendor page are read from the pasted text of the page, and an order that is in the database says so', () => {
  const js = read('web/order-to-database.js');
  // no script in the console of the vendor: the page is copied and pasted, and read in the browser
  assert.doesNotMatch(js, /pageReader/);
  assert.match(js, /function readPageText\(text, link\)/);
  assert.match(js, /function applyPage\(row, page\)/);
  assert.match(js, /'Fill in from the page of the vendor'/);
  assert.match(js, /placeholder = 'Paste the text of the page here'/);
  assert.match(js, /applyPage: applyPage, readPageText: readPageText/);
  // a label alone on its line takes the next line (otherwise "Clone number" would be the label "Clone" with the value "number")
  assert.match(js, /if \(alone\.test\(lines\[i\]\)\) \{/);
  // the button of an order whose lines are in the database already says so; only the same name or the same catalog number counts
  assert.match(js, /document\.createTextNode\('In the database'\)/);
  assert.match(js, /return have === wanted \|\| \(catalog\.length >= 4/);
});

test('a screenshot of a vendor page is read in the browser (OCR files kept in the repo), and the order window is not slowed by a server without internet', () => {
  const js = read('web/order-to-database.js');
  // the image is pasted, dropped or chosen; its text goes through the same reading as a pasted text
  assert.match(js, /function readImage\(file, onProgress\)/);
  assert.match(js, /workerPath: here\('worker-wrapper\.js'\)/);
  assert.match(js, /paste\.addEventListener\('paste'/);
  assert.match(js, /image\.accept = 'image\/\*'/);
  const wrapper = read('web/ocr/worker-wrapper.js');
  assert.match(wrapper, /\.traineddata\.gz\.js/);
  assert.match(wrapper, /importScripts\('worker\.min\.js'\)/);
  for (const name of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'eng.traineddata.gz.js']) {
    assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'web', 'ocr', name)), name);
  }
  assert.match(read('docker-compose.inventory.yml'), /\.\/web\/ocr:\/elabftw\/web\/ocr:ro/);
  // the server asks the page of a link itself: without internet that is a wait of about 5 seconds for each link
  assert.match(js, /stop\.abort\(\);\s*\}, 1500\)/);
  assert.match(js, /markPreviewDown\(\);/);
  // the cards: one list of primers, one check at a time, only the cards that are seen, the oligos of a sheet remembered
  assert.match(js, /const allPrimersOnce = function/);
  assert.match(js, /new IntersectionObserver/);
  assert.match(js, /'otd-sheet-' \+ longName/);
});
