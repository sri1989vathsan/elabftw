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

use Elabftw\Enums\Storage;
use Elabftw\Models\Inventory;
use PDO;
use Throwable;
use ZipArchive;

use function basename;
use function filesize;
use function header;
use function http_response_code;
use function is_string;
use function preg_match;
use function preg_replace;
use function readfile;
use function set_time_limit;
use function sprintf;
use function sys_get_temp_dir;
use function tempnam;
use function trim;
use function unlink;
use function mb_substr;

/**
 * Fork-only. The sequencing files (ab1 traces, FASTA reads kept as name.read.fasta) of a plasmid of the database, or of every plasmid the
 * user can read, as a zip file with a folder for each plasmid.  ?entry=<id> for one plasmid, ?all=1 for the whole database.
 * Needs a login; an entry the user cannot read is left out.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';

const READS = '/\.(ab1|abi|scf|read\.fasta|read\.fa)$/i';

function refuse(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    exit($message);
}

function clean(string $text, int $length): string
{
    $text = trim((string) preg_replace('/[^A-Za-z0-9_.()#+ -]+/', '_', $text));
    return mb_substr($text === '' ? 'plasmid' : $text, 0, $length);
}

set_time_limit(0);
$all = ($_GET['all'] ?? '') === '1';
$entryId = (int) ($_GET['entry'] ?? 0);
if (!$all && $entryId <= 0) {
    refuse(400, 'Say which plasmid (?entry=) or ask for all of them (?all=1).');
}

// the files to put in the zip: entry id => title, files
$entries = array();
if ($all) {
    $Db = Db::getConnection();
    $req = $Db->prepare("SELECT uploads.item_id, uploads.real_name, uploads.long_name, uploads.storage, inventory.title, inventory.custom_id
        FROM uploads JOIN inventory ON inventory.id = uploads.item_id
        WHERE uploads.type = 'inventory' AND uploads.state = 1 AND uploads.real_name REGEXP '\\\\.(ab1|abi|scf|read\\\\.fasta|read\\\\.fa)$'
        ORDER BY inventory.id, uploads.id");
    $Db->execute($req);
    foreach ($req->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $id = (int) $row['item_id'];
        $entries[$id] ??= array('title' => (($row['custom_id'] ?? '') !== '' ? '#' . $row['custom_id'] . ' ' : '') . $row['title'], 'files' => array());
        $entries[$id]['files'][] = $row;
    }
    // only the plasmids the user can read
    foreach ($entries as $id => $entry) {
        try {
            $Entity = new Inventory($App->Users, $id);
            $Entity->readOne();
        } catch (Throwable) {
            unset($entries[$id]);
        }
    }
} else {
    try {
        $Entity = new Inventory($App->Users, $entryId);
        $Entity->readOne();
    } catch (Throwable) {
        refuse(403, 'You cannot open this entry.');
    }
    $title = ((string) ($Entity->entityData['custom_id'] ?? '') !== '' ? '#' . $Entity->entityData['custom_id'] . ' ' : '') . (string) ($Entity->entityData['title'] ?? '');
    $files = array();
    foreach ($Entity->entityData['uploads'] ?? array() as $upload) {
        if (preg_match(READS, (string) $upload['real_name']) === 1 && (int) ($upload['state'] ?? 1) === 1) {
            $files[] = $upload;
        }
    }
    $entries[$entryId] = array('title' => $title, 'files' => $files);
}

$count = 0;
foreach ($entries as $entry) {
    $count += count($entry['files']);
}
if ($count === 0) {
    refuse(404, 'There are no sequencing files to download.');
}

$path = tempnam(sys_get_temp_dir(), 'seqzip');
if ($path === false) {
    refuse(500, 'The zip file could not be made.');
}
$zip = new ZipArchive();
if ($zip->open($path, ZipArchive::OVERWRITE) !== true) {
    refuse(500, 'The zip file could not be made.');
}
$added = 0;
foreach ($entries as $id => $entry) {
    $folder = clean((string) $entry['title'], 60) . ($all ? ' (' . $id . ')' : '');
    $seen = array();
    foreach ($entry['files'] as $file) {
        $name = clean(basename((string) $file['real_name']), 100);
        // two files of one name keep both
        $seen[$name] = ($seen[$name] ?? 0) + 1;
        if ($seen[$name] > 1) {
            $name = $seen[$name] . '_' . $name;
        }
        try {
            $content = Storage::from((int) $file['storage'])->getStorage()->getFs()->read((string) $file['long_name']);
        } catch (Throwable) {
            continue;
        }
        $zip->addFromString($folder . '/' . $name, $content);
        $added++;
    }
}
$zip->close();
if ($added === 0) {
    unlink($path);
    refuse(404, 'The sequencing files could not be read.');
}
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . ($all ? 'sequencing-files-all-plasmids' : clean((string) ($entries[$entryId]['title'] ?? 'plasmid'), 50) . ' sequencing files') . '.zip"');
header('Content-Length: ' . (string) filesize($path));
readfile($path);
unlink($path);
