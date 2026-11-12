<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Models\Inventory;
use Throwable;

use function array_values;
use function json_encode;
use function preg_match;

/**
 * The page that aligns the sequencing reads (ab1 files) of an entry of the database to its reference sequence (a GenBank
 * or FASTA file of the entry) and shows the alignment in the Open Vector Editor. The alignment is done by align.php.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';

$entryId = (int) ($_GET['entry'] ?? 0);
$title = '';
$reference = null;
$referenceFixed = false;
$reads = array();
$clustal = null;
// ?clustal=3 opens one saved alignment, ?clustal=3,5 several of them together
$wantedClustals = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) ($_GET['clustal'] ?? ''))))));
$clustals = array();
// every alignment kept in the entry (Clustal files), to be opened from the menu of the page
$saved = array();
try {
    $Entity = new Inventory($App->Users, $entryId > 0 ? $entryId : null);
    $Entity->readOne();
    $title = (string) ($Entity->entityData['title'] ?? '');
    $wanted = (int) ($_GET['ref'] ?? 0);
    foreach ($Entity->entityData['uploads'] ?? array() as $upload) {
        $file = array(
            'id' => (int) $upload['id'],
            'long_name' => (string) $upload['long_name'],
            'real_name' => (string) $upload['real_name'],
            'storage' => (int) $upload['storage'],
        );
        if (preg_match('/\.(aln|clustal|clw)$/i', $file['real_name']) === 1) {
            $saved[] = array('id' => $file['id'], 'name' => $file['real_name']);
            // the alignments of the entry that are opened (?clustal=<upload id>[,<upload id>])
            if (in_array($file['id'], $wantedClustals, true)) {
                $clustals[$file['id']] = $file;
            }
        } elseif (preg_match('/\.(ab1|read\.fasta|read\.fa)$/i', $file['real_name']) === 1) {
            $reads[] = $file;
        } elseif (preg_match('/\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i', $file['real_name']) === 1) {
            // the reference is the one asked for, else the oldest sequence file of the entry (the list is newest first: a later file of the
            // same kind is a copy, not the plasmid, and the Sequence tab brings back to the reference)
            if ($wanted > 0 && $file['id'] === $wanted) {
                $reference = $file;
                $referenceFixed = true;
            } elseif (!$referenceFixed) {
                $reference = $file;
            }
        }
    }
} catch (Throwable) {
    http_response_code(403);
    exit('You cannot open this entry.');
}

$openClustals = array();
foreach ($wantedClustals as $id) {
    if (isset($clustals[$id])) {
        $openClustals[] = $clustals[$id];
    }
}
$clustal = $openClustals[0] ?? null;
header('Content-Type: text/html; charset=utf-8');
$h = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
$sequenceUrl = $reference === null ? '' : 'index.php?' . http_build_query(array('entry' => $entryId, 'upload' => $reference['id'], 'f' => $reference['long_name'], 'name' => $reference['real_name'], 'storage' => $reference['storage']));
$files = json_encode(array('reference' => $reference, 'reads' => array_values($reads), 'clustal' => $clustal, 'clustals' => $openClustals, 'saved' => $saved), JSON_THROW_ON_ERROR);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sequencing alignment</title>
  <link rel="stylesheet" href="vendor/ove.css">
  <link rel="stylesheet" href="aa-colors.css?v=<?= (int) filemtime(__DIR__ . '/aa-colors.css') ?>">
  <link rel="stylesheet" href="viewer.css?v=<?= (int) filemtime(__DIR__ . '/viewer.css') ?>">
</head>
<body
  data-entry="<?= $entryId ?>"
  data-csrf="<?= $h((string) $App->Session->get('csrf')) ?>"
  data-files="<?= $h($files) ?>"
>
  <div id="bar">
    <a id="back" href="../registry.php?mode=view&amp;id=<?= $entryId ?>">&larr; Back to eLabFTW</a>
    <strong id="entry-title"><?= $h($title) ?></strong>
    <span class="view-switch" role="tablist" aria-label="View">
      <?php if ($sequenceUrl !== '') { ?><a href="<?= $h($sequenceUrl) ?>" role="tab">Sequence</a><?php } ?>
      <a href="#" role="tab" aria-selected="true" class="current">Alignment</a>
    </span>
    <span id="title">Sequencing alignment</span>
    <?php if ($sequenceUrl !== '') { ?><a id="close-alignment" class="close-alignment" href="<?= $h($sequenceUrl) ?>" title="Back to the plasmid (Esc)">&#10005; Close alignment</a><?php } ?>
    <label class="close-alignment" title="The program that aligns the reads to the sequence" style="margin:0">Algorithm
      <select id="algorithm" aria-label="Algorithm"><option value="builtin">Built-in</option><option value="mafft">MAFFT</option><option value="clustalo">Clustal Omega</option></select>
    </label>
    <label class="close-alignment" id="read-label" title="Look at all the reads in one alignment, or at each read on its own (Save and Export take what is shown)" style="margin:0" hidden>Show
      <select id="read-view" aria-label="Reads shown"></select>
    </label>
    <span class="close-alignment" style="margin:0" title="The sequencing files (ab1, FASTA reads) as a zip, one folder for each plasmid">Download reads:
      <a href="download-reads.php?entry=<?= $entryId ?>">this plasmid</a> &middot; <a href="download-reads.php?all=1">all plasmids</a>
    </span>
    <button type="button" id="export-png" class="close-alignment" hidden title="Save the alignment as a PNG picture (letters, differences and positions; no traces)">PNG</button>
    <button type="button" id="export-pdf" class="close-alignment" hidden title="Save the alignment as a PDF file (vector, in pages; letters, differences and positions; no traces)">PDF</button>
    <button type="button" id="export-clustal" class="close-alignment" hidden title="Download this alignment as a Clustal file">Export Clustal</button>
    <input type="text" id="alignment-name" class="close-alignment" hidden maxlength="60" placeholder="Name of this alignment" aria-label="Name of this alignment" title="A new name keeps this alignment next to the others of the entry, the name of a saved one replaces it" style="width:170px">
    <button type="button" id="save-alignment" class="close-alignment" hidden title="Keep this alignment in the files of the entry (a Clustal file, opened again from there), with the sequencing files (ab1) that were dropped on this page">Save in the entry</button>
    <label class="close-alignment" id="saved-label" title="The alignments kept in this entry: each opens on its own" style="margin:0" hidden>Saved
      <select id="saved-alignments" aria-label="Saved alignments"></select>
    </label>
    <span class="close-alignment" id="together" hidden style="position:relative">
      <button type="button" id="together-button" title="Look at several saved alignments in one view" aria-expanded="false">View together&hellip;</button>
      <div id="together-panel" hidden style="position:absolute;top:100%;left:0;z-index:30;min-width:240px;max-height:320px;overflow:auto;padding:8px 10px;background:#fff;color:#222;border:1px solid #bbb;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.2)"></div>
    </span>
    <label class="close-alignment" title="Show an alignment from a Clustal file" style="cursor:pointer;margin:0">Open Clustal<input type="file" id="import-clustal" accept=".aln,.clustal,.clw,.txt" hidden></label>
    <span id="status" role="status">Loading the sequences...</span>
  </div>
  <div id="summary" hidden></div>
  <div id="root"></div>
  <script src="export-image.js?v=<?= (int) filemtime(__DIR__ . '/export-image.js') ?>"></script>
  <script src="alignment-store.js?v=<?= (int) filemtime(__DIR__ . '/alignment-store.js') ?>"></script>
  <script src="vendor/bio-parsers.umd.js"></script>
  <script src="vendor/ove.umd.js"></script>
  <script src="alignment.js?v=<?= (int) filemtime(__DIR__ . '/alignment.js') ?>"></script>
</body>
</html>
