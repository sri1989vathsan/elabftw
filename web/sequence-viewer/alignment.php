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
$reads = array();
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
        if (preg_match('/\.ab1$/i', $file['real_name']) === 1) {
            $reads[] = $file;
        } elseif (preg_match('/\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i', $file['real_name']) === 1) {
            // the reference is the one asked for, else the first sequence file of the entry
            if ($reference === null || ($wanted > 0 && $file['id'] === $wanted)) {
                $reference = $file;
            }
        }
    }
} catch (Throwable) {
    http_response_code(403);
    exit('You cannot open this entry.');
}

header('Content-Type: text/html; charset=utf-8');
$h = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
$sequenceUrl = $reference === null ? '' : 'index.php?' . http_build_query(array('entry' => $entryId, 'upload' => $reference['id'], 'f' => $reference['long_name'], 'name' => $reference['real_name'], 'storage' => $reference['storage']));
$files = json_encode(array('reference' => $reference, 'reads' => array_values($reads)), JSON_THROW_ON_ERROR);
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
    <span id="status" role="status">Loading the sequences...</span>
  </div>
  <div id="summary" hidden></div>
  <div id="root"></div>
  <script src="alignment-store.js?v=<?= (int) filemtime(__DIR__ . '/alignment-store.js') ?>"></script>
  <script src="vendor/bio-parsers.umd.js"></script>
  <script src="vendor/ove.umd.js"></script>
  <script src="alignment.js?v=<?= (int) filemtime(__DIR__ . '/alignment.js') ?>"></script>
</body>
</html>
