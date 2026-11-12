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

use Elabftw\Enums\AccessType;
use Elabftw\Models\Inventory;
use Throwable;

/**
 * The page of the sequence editor, opened from an entry of the database: it needs a login and the right to read the entry,
 * and the changes are saved (as a new version of the file) when the user can write the entry.
 * The editor files are in vendor/ (fetched with bin/fetch-ove.sh) and viewer.js does the rest.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';

// the application does not ask for a login on pages named index.php: this one needs it
if (!$App->Session->has('is_auth')) {
    header('Location: ../login.php');
    exit;
}

$entryId = (int) ($_GET['entry'] ?? 0);
$title = '';
$canWrite = false;
try {
    $Entity = new Inventory($App->Users, $entryId > 0 ? $entryId : null);
    $Entity->readOne();
    $title = (string) ($Entity->entityData['title'] ?? '');
    try {
        $Entity->canOrExplode(AccessType::Write);
        $canWrite = !$Entity->isReadOnly;
    } catch (Throwable) {
        $canWrite = false;
    }
} catch (Throwable) {
    http_response_code(403);
    exit('You cannot open this entry.');
}

// the first page is the frame of the tabs: each plasmid is opened in a frame of its own (embedded=1), File > Open adds another one
if (!isset($_GET['embedded'])) {
    $query = $_GET;
    unset($query['embedded']);
    header('Content-Type: text/html; charset=utf-8');
    $first = json_encode(array(
        'entry' => $entryId,
        'query' => http_build_query($query),
        'title' => $title,
    ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR);
    ?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sequence editor</title>
  <link rel="stylesheet" href="tabs.css?v=<?= (int) filemtime(__DIR__ . '/tabs.css') ?>">
</head>
<body>
  <div id="tab-bar">
    <a id="tab-back" href="../registry.php?mode=view&amp;id=<?= $entryId ?>">&larr; Back to eLabFTW</a>
    <div id="tab-list"></div>
  </div>
  <div id="main">
    <aside id="open-panel" hidden aria-label="Search the Database">
      <div id="open-head">
        <input id="open-search" type="search" placeholder="Search the Database by name or number" aria-label="Search the Database">
        <button id="open-close" type="button" aria-label="Close the search" title="Close the search">&times;</button>
      </div>
      <div id="open-results"></div>
    </aside>
    <div id="stage"></div>
  </div>
  <script type="application/json" id="first-tab"><?= $first ?></script>
  <script src="tabs.js?v=<?= (int) filemtime(__DIR__ . '/tabs.js') ?>"></script>
</body>
</html>
    <?php
    exit;
}

header('Content-Type: text/html; charset=utf-8');
$h = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sequence editor</title>
  <base target="_top">
  <link rel="stylesheet" href="vendor/ove.css">
  <link rel="stylesheet" href="aa-colors.css?v=<?= (int) filemtime(__DIR__ . '/aa-colors.css') ?>">
  <link rel="stylesheet" href="viewer.css?v=<?= (int) filemtime(__DIR__ . '/viewer.css') ?>">
</head>
<body
  class="embedded"
  data-library-url="features-library.js?v=<?= (int) filemtime(__DIR__ . '/features-library.js') ?>"
  data-entry="<?= $entryId ?>"
  data-upload="<?= (int) ($_GET['upload'] ?? 0) ?>"
  data-can-write="<?= $canWrite ? '1' : '0' ?>"
  data-csrf="<?= $h((string) $App->Session->get('csrf')) ?>"
>
  <div id="bar">
    <a id="back" href="../registry.php?mode=view&amp;id=<?= $entryId ?>">&larr; Back to eLabFTW</a>
    <strong id="entry-title"><?= $h($title) ?></strong>
    <span id="title"></span>
    <label class="map-style" title="Look of the circular map">Map style
      <select id="map-style" aria-label="Map style">
        <option value="classic">Classic (editor)</option>
        <option value="clean">New: clean</option>
        <option value="vivid">New: vivid</option>
        <option value="dark">New: dark</option>
      </select>
    </label>
    <span id="save-state" role="status"></span>
    <span id="status" role="status">Loading the sequence...</span>
  </div>
  <div id="workspace">
    <div id="root"></div>
    <aside id="tool-sidebar" aria-label="Tools"></aside>
  </div>
  <script src="../primer-tools.js?v=<?= (int) filemtime(dirname(__DIR__) . '/primer-tools.js') ?>"></script>
  <script src="../primer-design.js?v=<?= (int) filemtime(dirname(__DIR__) . '/primer-design.js') ?>"></script>
  <script src="sidebar.js?v=<?= (int) filemtime(__DIR__ . '/sidebar.js') ?>"></script>
  <script src="vendor/sequence-utils.umd.js"></script>
  <script src="digest-compare.js?v=<?= (int) filemtime(__DIR__ . '/digest-compare.js') ?>"></script>
  <script src="alignment-store.js?v=<?= (int) filemtime(__DIR__ . '/alignment-store.js') ?>"></script>
  <script src="align-tab.js?v=<?= (int) filemtime(__DIR__ . '/align-tab.js') ?>"></script>
  <script src="enzymes-tab.js?v=<?= (int) filemtime(__DIR__ . '/enzymes-tab.js') ?>"></script>
  <script src="origin-tab.js?v=<?= (int) filemtime(__DIR__ . '/origin-tab.js') ?>"></script>
  <script src="history-tab.js?v=<?= (int) filemtime(__DIR__ . '/history-tab.js') ?>"></script>
  <script src="annotate.js?v=<?= (int) filemtime(__DIR__ . '/annotate.js') ?>"></script>
  <script src="annotate-tab.js?v=<?= (int) filemtime(__DIR__ . '/annotate-tab.js') ?>"></script>
  <script src="oligo-style.js?v=<?= (int) filemtime(__DIR__ . '/oligo-style.js') ?>"></script>
  <script src="view-toggles.js?v=<?= (int) filemtime(__DIR__ . '/view-toggles.js') ?>"></script>
  <script src="oligo-editor.js?v=<?= (int) filemtime(__DIR__ . '/oligo-editor.js') ?>"></script>
  <script src="primer-menu.js?v=<?= (int) filemtime(__DIR__ . '/primer-menu.js') ?>"></script>
  <script src="tools-tab.js?v=<?= (int) filemtime(__DIR__ . '/tools-tab.js') ?>"></script>
  <script src="blast-tab.js?v=<?= (int) filemtime(__DIR__ . '/blast-tab.js') ?>"></script>
  <script src="tools-basic.js?v=<?= (int) filemtime(__DIR__ . '/tools-basic.js') ?>"></script>
  <script src="tools-pcr.js?v=<?= (int) filemtime(__DIR__ . '/tools-pcr.js') ?>"></script>
  <script src="open-menu.js?v=<?= (int) filemtime(__DIR__ . '/open-menu.js') ?>"></script>
  <script src="lineage-paste.js?v=<?= (int) filemtime(__DIR__ . '/lineage-paste.js') ?>"></script>
  <script src="primers-panel.js?v=<?= (int) filemtime(__DIR__ . '/primers-panel.js') ?>"></script>
  <script src="export-image.js?v=<?= (int) filemtime(__DIR__ . '/export-image.js') ?>"></script>
  <script src="circular-map.js?v=<?= (int) filemtime(__DIR__ . '/circular-map.js') ?>"></script>
  <script src="vendor/bio-parsers.umd.js"></script>
  <script src="enzymes-library.js?v=<?= (int) filemtime(__DIR__ . '/enzymes-library.js') ?>"></script>
  <script src="vendor/ove.umd.js"></script>
  <script src="viewer.js?v=<?= (int) filemtime(__DIR__ . '/viewer.js') ?>"></script>
</body>
</html>
