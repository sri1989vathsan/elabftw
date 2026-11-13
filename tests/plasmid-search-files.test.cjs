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
  // an entry of the lab is locked: it is opened to be looked at; one of My entries is opened to be edited
  assert.match(js, /window\.location\.href = 'registry\.php\?mode=' \+ \(where === 'both' \|\| where === 'lab' \? 'view' : 'edit'\) \+ '&id=' \+ made\[0\];/);
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
  assert.match(js, /' in the database'/);
  assert.match(js, /return normalName\(entry\.title\) === wanted \|\| \(catalog\.length >= 4/);
});

test('a screenshot of a vendor page is read in the browser (OCR files kept in the repo), and the order window is not slowed by a server without internet', () => {
  const js = read('web/order-to-database.js');
  // the image is pasted, dropped or chosen; its text goes through the same reading as a pasted text
  assert.match(js, /function readImage\(file, onProgress\)/);
  assert.match(js, /workerPath: here\('worker-wrapper\.js'\)/);
  assert.match(js, /paste\.addEventListener\('paste'/);
  assert.match(js, /image\.accept = 'image\/\*,application\/pdf,\.pdf'/);
  // a PDF is read too: its text by the places of the words (a scan is drawn and read like an image)
  assert.match(js, /async function readPdf\(file, onProgress\)/);
  assert.match(js, /await \(isPdf \? readPdf : readImage\)\(file/);
  for (const name of ['pdf.min.js', 'pdf.worker.min.js']) {
    assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'web', 'ocr', name)), name);
  }
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
  assert.match(js, /const allPrimersOnce = primersOnce;/);
  assert.match(js, /new IntersectionObserver/);
  assert.match(js, /'otd-sheet-' \+ longName/);
});

test('the filter buttons of the orders page keep a space between their lines when they wrap', () => {
  assert.match(read('web/order-primers.js'), /\.orders-toolbar-row \.btn-group \{ row-gap: 0\.4rem; \}/);
});

test('the page reader knows the layout of BioLegend and Abcam pages (verified reactivity, application notes with the clone, RRID catalog numbers, sentences)', () => {
  const js = read('web/order-to-database.js');
  assert.match(js, /verified reactivity\|reacts with/);
  assert.match(js, /applications\?\|suitable for/);
  // the clone is also found in a sentence of the notes ("Clone 30-F11 reacts with..."), the conjugate in "conjugated with X under..."
  assert.match(js, /\\bclone\\s\*\(\?:no\\\.\?\|number\|name\)\?\\s\*\[:#\]\?\\s\*\(\[A-Za-z0-9\]\*\\d\[A-Za-z0-9-\]\*\)/);
  assert.match(js, /conjugated\\s\+\(\?:with\|to\)/);
  // the catalog numbers of the RRID lines come first; a number in a sentence is another product, and the one in the link decides
  assert.match(js, /RRID\\b\|\\bAB_/);
  assert.match(js, /String\(row\.link \|\| ''\)\.indexOf\(number\) !== -1/);
  assert.match(js, /see \(\?:reactivity\|application\|all\) \(\?:data\|images\?\)/);
});

test('the suppliers of the lab are known by their links and by their names (also with a slip), and reagent pages with article and CAS numbers are read', () => {
  const js = read('web/order-to-database.js');
  for (const domain of ['carlroth.com', 'qiagen.com', 'promega.com', 'stemcell.com', 'starlabgroup.com', 'lubio.ch', 'lucerna-chem.ch', 'mt.com']) {
    assert.ok(js.includes("'" + domain + "'"), domain);
  }
  assert.match(js, /function vendorOfName\(typed\)/);
  assert.match(js, /return vendorOfName\(typed\);/);
  assert.match(js, /starlab\|sarstedt\|corning\|kaiser\|lyreco/);
  assert.match(js, /\['CAS number', 'cas \(\?:number/);
  assert.match(js, /article \(\?:number/);
  assert.match(js, /carlroth\\\.com/);
});

test('an item is added once: what is in the Database is found, cannot be ticked, is linked, and is looked for again before the add', () => {
  const js = read('web/order-to-database.js');
  assert.match(js, /async function findExisting\(row\)/);
  assert.match(js, /async function markExisting\(list\)/);
  assert.match(js, /await markExisting\(rows\);\s*draw\(\);/);
  assert.match(js, /tick\.disabled = Boolean\(row\.existing\);/);
  assert.match(js, /document\.createTextNode\('In the Database: '\)/);
  // a second click while it adds, the same item twice in one add, and a line that appeared in the meantime
  assert.match(js, /let adding = false;/);
  assert.match(js, /const key = row\.sequence \? 'seq:' \+ letters/);
  assert.match(js, /row\.existing = await findExisting\(row\);/);
  assert.match(js, /window\.dispatchEvent\(new CustomEvent\('otd:added'\)\)/);
});

test('the state of an order is in the header of its card, in the look of the LabCollector pill (copied, nothing of the orders page changed), which is hidden together with the resource fields', () => {
  const js = read('web/order-to-database.js');
  assert.match(js, /card\.querySelector\('\.orders-labcollector-toggle'\)/);
  assert.match(js, /const pillClass = pillSource \? pillSource\.className/);
  assert.match(js, /fas fa-up-right-from-square/);
  assert.match(js, /'otd-status'/);
  const primers = read('web/order-primers.js');
  assert.match(primers, /\.orders-card \.orders-labcollector-toggle \{ display: none !important; \}/);
  assert.match(primers, /function hideResourceLinking\(\)/);
  assert.match(primers, /input\[placeholder\^="Link an existing resource"\]/);
  // the orders component is not touched by these changes
  const { execSync } = require('node:child_process');
  const changed = execSync('git diff --name-only HEAD~1 HEAD || true', { cwd: require('node:path').join(__dirname, '..') }).toString();
  assert.doesNotMatch(changed, /OrdersBoard\.svelte/);
});

test('placing an order: a link adds the new entry of the Database by itself, with its module and its columns (shown and editable), read from the page of the link when the server has internet', () => {
  const js = read('web/order-to-database.js');
  // the form of a new order: title and module filled in, the row added by itself for an order with a link (not for an item that is there already)
  assert.match(js, /const autoAddEntry = function \(\)/);
  assert.match(js, /\/Add a new entry of the database instead\/\.test\(candidate\.textContent\)/);
  assert.match(js, /findExisting\(\{ name: row\.name, catalog: row\.catalog, sequence: '' \}\)/);
  // the columns of the module under the row, and what the person sees is what the entry gets
  assert.match(js, /const refreshPanel = async function \(rowEl\)/);
  // the columns are in a window that opens when the button of the new entry is clicked (not for a row that is added by itself), and again
  // from the "Columns..." button of the row; what is there is what the entry gets
  assert.match(js, /const openColumns = function \(rowEl\)/);
  assert.match(js, /autoClicking = true;\s*button\.click\(\);\s*autoClicking = false;/);
  assert.match(js, /button\.textContent = 'Columns \(' \+ filled \+ '\)\.\.\.';/);
  assert.match(js, /made\.values = Object\.assign\(\{\}, panel\.values\);/);
  assert.match(js, /window\.fetch = function \(input, init\)/);
  // the page behind the link, asked of the server (link-page.php), once, with a short wait and a breaker; also used by the window of an order
  assert.match(js, /fetch\('link-page\.php\?url=' \+ encodeURIComponent\(link\)/);
  assert.match(js, /const read = await pageFromLink\(r\.link\);/);
  // the endpoint and its safety, and the mount
  const php = read('web/link-page.php');
  assert.match(php, /function safeTarget\(string \$url\): \?array/);
  assert.match(php, /FILTER_FLAG_NO_PRIV_RANGE \| FILTER_FLAG_NO_RES_RANGE/);
  assert.match(php, /CURLOPT_RESOLVE/);
  assert.match(php, /CURLOPT_FOLLOWLOCATION => false/);
  assert.match(php, /isAnonymous\(\)/);
  assert.match(read('docker-compose.inventory.yml'), /\.\/web\/link-page\.php:\/elabftw\/web\/link-page\.php:ro/);
  // the tags with the names of the linked entries are not shown
  assert.match(read('web/order-primers.js'), /\.orders-card \.orders-item-header a\.badge \{ display: none !important; \}/);
});

test('the entry of the order form goes into the lab database, and one page that cannot be read does not stop the others from being read', () => {
  const js = read('web/order-to-database.js');
  // the form makes the entry without saying where it goes (My entries, private, no number): the lab database is where it goes
  assert.match(js, /args\[1\] = Object\.assign\(\{\}, init, \{ body: JSON\.stringify\(Object\.assign\(\{\}, body, \{ register: 'lab' \}\)\) \}\);/);
  assert.match(js, /nativeFetch\.apply\(this, args\)/);
  // the reader of links is switched off only when the server could not be reached, for 3 minutes (a block or an error page is not that)
  assert.match(js, /'otd-page-down-v2'/);
  assert.match(js, /3 \* 60 \* 1000/);
  assert.match(js, /return answer && answer\.ok && answer\.text \? readPageText\(answer\.text, link\) : null;/);
});

test('the page of an entry of a module has "Started on", owner and team at the bottom, under the permissions, with a space between label and name', () => {
  const js = read('web/planned.js');
  assert.match(js, /Moved here\s+\* in the browser: the template of the page is not changed/);
  assert.match(js, /\/\^\\s\*Started on\\b\/\.test\(node\.textContent\)/);
  assert.match(js, /node\.textContent\.trim\(\) === 'Permissions'/);
  assert.match(js, /anchor\.after\(section\);/);
  assert.match(js, /section\.otd-ownership \.edit-mode-label \{ margin-right: 0\.75rem; min-width: 6rem; \}/);
  // starting where the text of the headings starts
  assert.match(js, /padding-left: 28px; padding-top: 0\.9rem;/);
  // the button "Who can edit" is in the Permissions (next to "Select who can edit this entry"), not in the toolbar that floats over the page
  const permissions = read('web/registry-permissions.js');
  assert.match(permissions, /Select who can edit this entry/);
  assert.match(permissions, /heading\.after\(button\);/);
  assert.doesNotMatch(permissions, /target\.append\(button\)/);
  // it applies to the view and the edit page of the Database only
  assert.match(js, /mode=\(view\|edit\)/);
});

test('an entry that enters the lab Database is locked, a plasmid sequence is not changed while it is locked, and an entry that was unlocked by hand goes back to locked after the edit', () => {
  // one call that only locks (the lock button toggles), for an entry with a number; used when an entry enters the Database and when an edit is over
  const lock = read('web/registry-lock.php');
  assert.match(lock, /\(\$Entry->entityData\['custom_id'\] \?\? null\) === null/);
  assert.match(lock, /UPDATE inventory SET locked = 1, lockedby = :user, locked_at = CURRENT_TIMESTAMP WHERE id = :id AND locked = 0/);
  // the imports and the window "Add from an order" lock what went into the lab, when everything of the request is done
  const transfer = read('web/registry-transfer.php');
  assert.match(transfer, /\$lockCreated = static function \(array \$ids, string \$register\)/);
  assert.equal((transfer.match(/\$lockCreated\(\$created, \$register\);/g) || []).length, 2);
  assert.match(transfer, /in_array\(\$register, array\('both', 'lab'\), true\)/);
  // the order form and the plasmid dialogs lock the entry they made in the lab
  assert.match(read('web/order-to-database.js'), /fetch\('registry-lock\.php'/);
  assert.match(read('web/sequence-add.js'), /await lockEntry\(id\);/);
  assert.match(read('web/sequence-add.js'), /for \(const id of made\) \{\s*await lockEntry\(id\);/);
  // the sequence of a locked plasmid: the server refuses a new file, a new version and the removal of the file
  const uploads = read('src/Models/Uploads.php');
  assert.match(uploads, /private function assertPlasmidSequenceNotLocked\(string \$realName\): void/);
  assert.match(uploads, /\$this->assertPlasmidSequenceNotLocked\(\$realName\);/);
  assert.match(uploads, /\$this->assertPlasmidSequenceNotLocked\(\(string\) \(\$this->uploadData\['real_name'\] \?\? ''\)\);/);
  // the sequence editor is read only while it is locked, also for the person who locked it
  assert.match(read('web/sequence-viewer/index.php'), /\$canWrite = !\$Entity->isReadOnly && !\$isLocked;/);
  assert.match(read('web/sequence-viewer/viewer.js'), /Locked: unlock this entry to edit its sequence/);
  // after an edit it is locked again: 30 seconds after the last save of the sequence, when the page is left, and when the edit page is left
  assert.match(read('web/sequence-viewer/viewer.js'), /relock\(false\);\s*\}, 30000\)/);
  assert.match(read('web/sequence-viewer/viewer.js'), /window\.addEventListener\('pagehide', function \(\) \{\s*relock\(true\);/);
  assert.match(read('web/planned.js'), /params\.get\('mode'\) !== 'edit'/);
  assert.match(read('web/planned.js'), /keepalive: true/);
  // the mounts of the new files
  const compose = read('docker-compose.inventory.yml');
  assert.match(compose, /\.\/web\/registry-lock\.php:\/elabftw\/web\/registry-lock\.php:ro/);
  assert.match(compose, /\.\/src\/Models\/Uploads\.php:\/elabftw\/src\/Models\/Uploads\.php:ro/);
  // "Started on" is not shown
  assert.match(read('web/planned.js'), /"Started on" is not shown/);
});

test('the oligo drawing does not delete nodes that the editor draws: "Edit Primer" (right click) opened a blank editor because the editor failed to remove a node that was gone', () => {
  const js = read('web/sequence-viewer/oligo-style.js');
  // nodes of the editor are hidden, not removed (the editor removes them itself when it draws again)
  assert.doesNotMatch(js, /node\.remove\(\)/);
  assert.match(js, /function hide\(node\)/);
  assert.match(js, /querySelectorAll\(':scope > text\.tg-primer-bases, :scope > text\.tg-primer-bases-insert'\)\.forEach\(hide\);/);
  assert.match(js, /g\.querySelectorAll\(':scope > text'\)\.forEach\(hide\);/);
  // the buttons of the maps wrap in a narrow panel instead of leaving it
  assert.match(read('web/sequence-viewer/viewer.css'), /\.view-toggles \{\s*display: flex;\s*flex-wrap: wrap;\s*max-width: 100%;/);
});

test('two primers ticked in the Primers tab give their PCR product, which can be saved as a new entry (a linear sequence made from the plasmid, with the two primers on it and attached)', () => {
  const panel = read('web/sequence-viewer/primers-panel.js');
  assert.match(panel, /action\('PCR product'/);
  assert.match(panel, /window\.ToolsPcr\.show\(picked\[0\]\.sequence, picked\[1\]\.sequence\);/);
  assert.match(panel, /pcrTicked\.hidden = tickedDb\.size !== 2;/);
  assert.match(panel, /orderTicked, pcrTicked, addTicked/);
  const pcr = read('web/sequence-viewer/tools-pcr.js');
  // the Tools panel opens with the two primers in it and the products are looked for
  assert.match(pcr, /window\.ToolsPcr\.fill = function \(a, b\)/);
  assert.match(pcr, /show: function \(a, b\)/);
  // the product is saved: the entry, the file (jsonToGenbank, linear, features of the template that it holds, the two primers), the parent, the primers
  assert.match(pcr, /function genbankOf\(item, template, name, names\)/);
  assert.match(pcr, /circular: false, sequence: item\.sequence/);
  assert.match(pcr, /type: 'primer_bind', start: 0/);
  assert.match(pcr, /action: 'add', entry: id, parent: context\.entryId/);
  assert.match(pcr, /await tools\.attach\(id, entry\.id\);/);
  assert.match(pcr, /\['lab', 'The lab database \(it is locked\)'\]/);
});

test('the oligo of a primer of the file: "Edit oligo" is in the menu of the editor when the primer is in the Database, the primer is drawn from its own letters (not from the edge of the row), and a locked primer is unlocked for its update and locked again', () => {
  // the menu of the editor on a primer of the file gets "Edit oligo in the Database" (opened on the mouse down: the menu closes before a click)
  const menu = read('web/sequence-viewer/primer-menu.js');
  assert.match(menu, /async function databasePrimerFor\(id\)/);
  // one entry: the dialog of the editor (Edit Primer / View Primer Details) is hidden for a primer that is in the Database
  assert.match(menu, /label\.textContent = 'Edit primer';/);
  assert.match(menu, /\^\(Edit Primer\|View Primer Details\)\$/);
  assert.match(menu, /link\.addEventListener\('mousedown', open\);/);
  assert.match(menu, /window\.OligoEditor\.open\(found\.id\);/);
  // the column of an oligo is counted from the first letter of the sequence of the row (a wide window has a margin on the left of the row)
  const style = read('web/sequence-viewer/oligo-style.js');
  assert.match(style, /rowText\.getBoundingClientRect\(\)\.left\) \/ charWidth\);/);
  assert.doesNotMatch(style, /rowEl\.getBoundingClientRect\(\)\.left\) \/ charWidth\);/);
  // a locked primer of its owner: "Unlock and update primer", locked again after the update (also when it failed)
  const oligo = read('web/sequence-viewer/oligo-editor.js');
  assert.match(oligo, /save\.textContent = 'Unlock and update primer';/);
  assert.match(oligo, /fetch\('\.\.\/registry-lock\.php'/);
  // the unlock asks first: the first click shows "Yes, unlock and update" and Cancel, only the second click unlocks
  assert.match(oligo, /if \(entry\.locked && !asking\) \{/);
  assert.match(oligo, /save\.textContent = 'Yes, unlock and update';/);
  assert.match(oligo, /append\(save, cancelUpdate, copy, fit, open\)/);
  // the lock call also locks an entry of My database
  assert.match(read('web/registry-lock.php'), /\(\$Entry->entityData\['personal_id'\] \?\? null\) === null/);
});

test('the buttons of the ticked primers are pills of one look that do not wrap: the main one filled, Detach in red, Expand at the right', () => {
  const panel = read('web/sequence-viewer/primers-panel.js');
  assert.match(panel, /action\('PCR product', function \(\) \{/);
  assert.match(panel, /\}, 'danger'\);/);
  const css = read('web/sequence-viewer/viewer.css');
  assert.match(css, /#tool-sidebar \.primers-pickbar-compact \{\s*flex-wrap: wrap;/);
  assert.match(css, /primers-pickbar-compact \.primers-btn \{\s*white-space: nowrap;/);
  assert.match(css, /\.primers-btn-danger \{\s*border-color: #e3b5b0;\s*color: #b42318;/);
  assert.match(css, /primers-btn-quiet:last-child \{\s*margin-left: auto;/);
});
