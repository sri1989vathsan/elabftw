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

/**
 * The sequence editor as a tool of the Tools menu: an editor to work on a sequence of your own (import a file, export it),
 * and a search to open the sequence of a plasmid of the database, which is then edited and saved with its entry.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';

header('Content-Type: text/html; charset=utf-8');
$h = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
$v = static fn(string $file): int => (int) filemtime(__DIR__ . '/' . $file);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sequence editor</title>
  <link rel="stylesheet" href="vendor/ove.css">
  <link rel="stylesheet" href="aa-colors.css?v=<?= (int) filemtime(__DIR__ . '/aa-colors.css') ?>">
  <link rel="stylesheet" href="viewer.css?v=<?= $v('viewer.css') ?>">
</head>
<body data-library-url="features-library.js?v=<?= (int) filemtime(__DIR__ . '/features-library.js') ?>" data-tool="1" data-entry="0" data-upload="0" data-can-write="0" data-csrf="<?= $h((string) $App->Session->get('csrf')) ?>">
  <div id="bar">
    <a id="back" href="../dashboard.php">&larr; eLabFTW</a>
    <strong id="entry-title">Sequence editor</strong>
    <span id="open-plasmid">
      <input id="plasmid-search" type="search" autocomplete="off" placeholder="Open a plasmid of the database..." aria-label="Search a plasmid of the database">
      <div id="plasmid-results" hidden></div>
    </span>
    <span id="save-state" role="status"></span>
        <label class="map-style" title="Look of the circular map">Map style
      <select id="map-style" aria-label="Map style">
        <option value="classic">Classic (editor)</option>
        <option value="clean">New: clean</option>
        <option value="vivid">New: vivid</option>
        <option value="dark">New: dark</option>
      </select>
    </label>
    <span id="status" role="status">Loading the editor...</span>
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
  <script src="align-tab.js?v=<?= (int) filemtime(__DIR__ . '/align-tab.js') ?>"></script>
  <script src="enzymes-tab.js?v=<?= (int) filemtime(__DIR__ . '/enzymes-tab.js') ?>"></script>
  <script src="origin-tab.js?v=<?= (int) filemtime(__DIR__ . '/origin-tab.js') ?>"></script>
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
  <script src="cloning-engine.js?v=<?= (int) filemtime(__DIR__ . '/cloning-engine.js') ?>"></script>
  <script src="cloning-insert.js?v=<?= (int) filemtime(__DIR__ . '/cloning-insert.js') ?>"></script>
  <script src="tools-gibson.js?v=<?= (int) filemtime(__DIR__ . '/tools-gibson.js') ?>"></script>
  <script src="tools-restriction.js?v=<?= (int) filemtime(__DIR__ . '/tools-restriction.js') ?>"></script>
  <script src="tools-goldengate.js?v=<?= (int) filemtime(__DIR__ . '/tools-goldengate.js') ?>"></script>
  <script src="primers-panel.js?v=<?= (int) filemtime(__DIR__ . '/primers-panel.js') ?>"></script>
  <script src="circular-map.js?v=<?= (int) filemtime(__DIR__ . '/circular-map.js') ?>"></script>
  <script src="vendor/bio-parsers.umd.js"></script>
  <script src="enzymes-library.js?v=<?= (int) filemtime(__DIR__ . '/enzymes-library.js') ?>"></script>
  <script src="vendor/ove.umd.js"></script>
  <script src="viewer.js?v=<?= $v('viewer.js') ?>"></script>
  <script src="tool.js?v=<?= $v('tool.js') ?>"></script>
</body>
</html>
