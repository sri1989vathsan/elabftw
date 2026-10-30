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
 * The page of the sequence viewer, shown in a frame of an entry of the database. It needs a login, the editor files are
 * in vendor/ (fetched with bin/fetch-ove.sh) and viewer.js does the rest.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sequence viewer</title>
  <link rel="stylesheet" href="vendor/ove.css">
  <link rel="stylesheet" href="viewer.css">
</head>
<body>
  <div id="status" role="status">Loading the sequence...</div>
  <div id="root"></div>
  <script src="vendor/bio-parsers.umd.js"></script>
  <script src="vendor/ove.umd.js"></script>
  <script src="viewer.js"></script>
</body>
</html>
