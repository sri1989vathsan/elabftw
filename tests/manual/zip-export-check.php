<?php

/**
 * Check of the ZIP export of web/registry-transfer.php (the files of the Database entries streamed into a zip): memory has to stay flat
 * however large the attachments are. It streams every attachment of the Database the way the export does and fails if the peak memory
 * is above 64 MB or the zip is not complete. Runs inside the web container, against its database:
 *   docker exec -i elabftw-inventory-web-1 php -d open_basedir= < tests/manual/zip-export-check.php
 * (the old export read every file into memory and used about 1.1 MB of PHP memory per MB of attachments)
 */

declare(strict_types=1);

require '/elabftw/vendor/autoload.php';

use ZipStream\ZipStream;

$pdo = new PDO('mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4', (string) getenv('DB_USER'), (string) getenv('DB_PASSWORD'), array(PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC));
$uploads = $pdo->query("SELECT item_id, real_name, long_name FROM uploads WHERE type = 'inventory' AND state = 1 ORDER BY id")->fetchAll();
$out = fopen('php://memory', 'w+b');
$zip = new ZipStream(sendHttpHeaders: false, outputStream: $out);
$added = 0;
$bytes = 0;
foreach ($uploads as $upload) {
    $path = '/var/lib/elabftw/uploads/' . $upload['long_name'];
    if (!is_file($path)) {
        continue;
    }
    $stream = fopen($path, 'rb');
    $zip->addFileFromStream('files/' . $upload['item_id'] . '/' . $added . '_' . preg_replace('#[/\\\\]+#', '_', (string) $upload['real_name']), $stream);
    fclose($stream);
    $bytes += (int) filesize($path);
    $added++;
    // the zip itself is not kept: only the memory of the export is looked at
    ftruncate($out, 0);
    rewind($out);
}
$zip->finish();
$peak = memory_get_peak_usage() / 1048576;
printf("%d files, %.1f MB of attachments, peak PHP memory %.1f MB\n", $added, $bytes / 1048576, $peak);
exit($peak > 64 ? 1 : 0);
