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

use Elabftw\Elabftw\CreateUploadFromFs;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\Storage;
use Elabftw\Hash\FileHash;
use Elabftw\Models\Inventory;
use Elabftw\Models\Users\Users;
use PDO;
use Throwable;
use ZipArchive;

use function array_column;
use function array_slice;
use function count;
use function fopen;
use function fputcsv;
use function fwrite;
use function file_get_contents;
use function gmdate;
use function hash_equals;
use function header;
use function http_response_code;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_substr;
use function preg_replace;
use function strtolower;
use function trim;

/**
 * Batch export and import of the entries of a module.
 *
 * GET ?export=1&category=ID&scope=lab|mine downloads a CSV of the entries (the lab Database, or all the entries of the user);
 * GET ?template=1&category=ID downloads a CSV with only the headings of the module.
 * POST {category, register: both|personal|none, rows: [{title, fields: {name: value}, extra: {name: value}}]} makes the entries
 * (up to 200 at a time); an entry that cannot be made is listed with the reason.
 */
require_once __DIR__ . '/app/init.inc.php';

function respond(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body);
    exit;
}

$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$userId = (int) $App->Users->userData['userid'];

$loadModule = static function (int $id) use ($pdo, $teamId): ?array {
    $req = $pdo->prepare('SELECT id, title, fields, settings FROM inventory_categories WHERE id = :id AND team = :team AND state = 1');
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $row = $req->fetch();
    return is_array($row) ? $row : null;
};
$fieldsOf = static function (array $module): array {
    $decoded = json_decode((string) $module['fields'], true);
    return is_array($decoded) && is_array($decoded['extra_fields'] ?? null) ? $decoded['extra_fields'] : array();
};

$isAdmin = (bool) $App->Users->isAdmin;
$teamUsers = static function () use ($pdo, $teamId): array {
    $req = $pdo->prepare('SELECT u.userid AS id, u.email, CONCAT(u.firstname, " ", u.lastname) AS name FROM users AS u INNER JOIN users2teams AS t ON t.users_id = u.userid WHERE t.teams_id = :team AND t.is_archived = 0 AND u.archived = 0 ORDER BY u.firstname, u.lastname');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    return $req->fetchAll();
};

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    // the users that can own what is imported (admins only)
    if (isset($_GET['users'])) {
        respond(200, array('users' => $isAdmin ? $teamUsers() : array(), 'is_admin' => $isAdmin, 'me' => $userId));
    }
    // selected entries: they have to be of one module
    $selected = array();
    if (isset($_GET['ids']) && (string) $_GET['ids'] !== '') {
        $selected = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $_GET['ids'])), static fn(int $n): bool => $n > 0)));
        $selected = array_slice($selected, 0, 500);
        $modulesReq = $pdo->prepare('SELECT DISTINCT category FROM inventory WHERE team = :team AND id IN (' . implode(',', $selected ?: array(0)) . ')');
        $modulesReq->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($modulesReq);
        $modules = $modulesReq->fetchAll(PDO::FETCH_COLUMN);
        if (count($modules) !== 1) {
            respond(400, array('error' => 'Select entries of one module to export them.'));
        }
        $_GET['category'] = (string) $modules[0];
    }
    $module = $loadModule((int) ($_GET['category'] ?? 0));
    if ($module === null) {
        respond(404, array('error' => 'This module is not in your team.'));
    }
    $definitions = $fieldsOf($module);
    $headings = array('Title');
    foreach ($definitions as $name => $definition) {
        $headings[] = (string) $name;
    }
    $slug = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', (string) $module['title']));
    if (isset($_GET['template'])) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $slug . '-template.csv"');
        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, $headings, ',', '"', '');
        exit;
    }
    if (!isset($_GET['export'])) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $scope = ($_GET['scope'] ?? 'lab') === 'mine' ? 'mine' : 'lab';
    $canFilter = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
    $where = $scope === 'mine' ? 'entity.userid = :userid' : 'entity.is_planned = 0 AND entity.custom_id IS NOT NULL';
    if ($selected !== array()) {
        // the entries that were selected, the ones that can be read
        $where = 'entity.id IN (' . implode(',', $selected) . ')';
    }
    $req = $pdo->prepare('SELECT entity.id, entity.title, entity.custom_id, entity.personal_id, entity.date, entity.metadata, CONCAT(u.firstname, " ", u.lastname) AS owner, u.email AS owner_email
        FROM inventory AS entity LEFT JOIN users AS u ON u.userid = entity.userid
        WHERE entity.state = 1 AND entity.team = :team AND entity.category = :category AND ' . $where . $canFilter . ' ORDER BY entity.custom_id, entity.id');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':category', (int) $module['id'], PDO::PARAM_INT);
    $req->bindValue(':userid', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $entries = $req->fetchAll();
    // the fields of the module first, then the other fields that entries have
    $names = array();
    foreach ($definitions as $name => $definition) {
        $names[(string) $name] = true;
    }
    $decodedEntries = array();
    foreach ($entries as $entry) {
        $metadata = json_decode((string) $entry['metadata'], true);
        $fields = is_array($metadata) && is_array($metadata['extra_fields'] ?? null) ? $metadata['extra_fields'] : array();
        $decodedEntries[] = $fields;
        foreach ($fields as $name => $field) {
            $names[(string) $name] = true;
        }
    }
    $asZip = ($_GET['format'] ?? 'csv') === 'zip';
    $label = $selected !== array() ? 'selected' : ($scope === 'mine' ? 'mine' : 'lab');
    $fileName = $slug . '-' . $label . '-' . gmdate('Y-m-d');
    $heading = array_merge(array('ID', 'My ID', 'Title', 'Date', 'Owner', 'Owner e-mail'), array_keys($names), $asZip ? array('Key', 'Files') : array());
    $rows = array();
    $zipFiles = array();
    foreach ($entries as $index => $entry) {
        $row = array((string) ($entry['custom_id'] ?? ''), (string) ($entry['personal_id'] ?? ''), (string) $entry['title'], (string) $entry['date'], (string) $entry['owner'], (string) ($entry['owner_email'] ?? ''));
        foreach (array_keys($names) as $name) {
            $value = $decodedEntries[$index][$name]['value'] ?? '';
            $row[] = is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value;
        }
        if ($asZip) {
            // the attached files go in the folder files/<key>/ of the zip
            $key = (string) ($index + 1);
            $uploads = $pdo->prepare("SELECT real_name, long_name, storage FROM uploads WHERE item_id = :id AND type = 'inventory' AND state = 1 ORDER BY id");
            $uploads->bindValue(':id', (int) $entry['id'], PDO::PARAM_INT);
            $pdo->execute($uploads);
            $fileNames = array();
            foreach ($uploads->fetchAll() as $upload) {
                $real = (string) preg_replace('/[\/\\\\]+/', '_', (string) $upload['real_name']);
                $zipFiles[] = array('path' => 'files/' . $key . '/' . $real, 'long_name' => (string) $upload['long_name'], 'storage' => (int) $upload['storage']);
                $fileNames[] = $real;
            }
            $row[] = $key;
            $row[] = implode('|', $fileNames);
        }
        $rows[] = $row;
    }
    if (!$asZip) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $fileName . '.csv"');
        $out = fopen('php://output', 'wb');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, $heading, ',', '"', '');
        foreach ($rows as $row) {
            fputcsv($out, $row, ',', '"', '');
        }
        exit;
    }
    // a zip: entries.csv and the files of the entries
    $csv = fopen('php://temp', 'w+b');
    fwrite($csv, "\xEF\xBB\xBF");
    fputcsv($csv, $heading, ',', '"', '');
    foreach ($rows as $row) {
        fputcsv($csv, $row, ',', '"', '');
    }
    rewind($csv);
    $zipPath = (string) tempnam(sys_get_temp_dir(), 'regzip');
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('entries.csv', (string) stream_get_contents($csv));
    foreach ($zipFiles as $file) {
        try {
            $zip->addFromString($file['path'], Storage::from($file['storage'])->getStorage()->getFs()->read($file['long_name']));
        } catch (Throwable) {
            // a file that cannot be read is left out
        }
    }
    $zip->close();
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $fileName . '.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
    unlink($zipPath);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = isset($_FILES['file']) ? array() : json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
// the entries that were ticked get another owner (admins only): each is renumbered in the list of the new owner, so My ID stays their own count
if (is_array($payload) && ($payload['action'] ?? '') === 'assign_owner') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can assign the owner of entries.'));
    }
    try {
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', is_array($payload['ids'] ?? null) ? $payload['ids'] : array()), static fn(int $n): bool => $n > 0))), 0, 500);
        $ownerId = (int) ($payload['owner'] ?? 0);
        $members = array_column($teamUsers(), 'id');
        if ($ids === array() || !in_array((string) $ownerId, array_map('strval', $members), true)) {
            respond(400, array('error' => 'Choose entries and an owner of the team.'));
        }
        $changed = 0;
        $read = $pdo->prepare('SELECT id, category, userid, personal_id FROM inventory WHERE id = :id AND team = :team AND state = 1');
        $next = $pdo->prepare('SELECT COALESCE(MAX(personal_id), 0) + 1 FROM inventory WHERE userid = :user AND category = :category');
        $write = $pdo->prepare('UPDATE inventory SET userid = :user, personal_id = :personal WHERE id = :id');
        foreach ($ids as $id) {
            $read->bindValue(':id', $id, PDO::PARAM_INT);
            $read->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($read);
            $entry = $read->fetch();
            if (!is_array($entry) || (int) $entry['userid'] === $ownerId) {
                continue;
            }
            $personal = null;
            if ($entry['personal_id'] !== null && $entry['category'] !== null) {
                $next->bindValue(':user', $ownerId, PDO::PARAM_INT);
                $next->bindValue(':category', (int) $entry['category'], PDO::PARAM_INT);
                $pdo->execute($next);
                $personal = (int) $next->fetchColumn();
            }
            $write->bindValue(':user', $ownerId, PDO::PARAM_INT);
            $write->bindValue(':personal', $personal, $personal === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
            $write->bindValue(':id', $id, PDO::PARAM_INT);
            $pdo->execute($write);
            $changed++;
        }
        respond(200, array('changed' => $changed));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage()));
    }
}

// one row of a file becomes an entry of the module; returns the id, or the reason it was not made
$makeEntry = static function (array $row, int $categoryId, array $definitions, string $register, ?Users $Owner = null) use ($App): array {
    $title = trim((string) ($row['title'] ?? ''));
    if ($title === '') {
        return array('id' => null, 'reason' => 'It has no title.');
    }
    // the fields of the module, with the values of the row
    $fields = $definitions;
    foreach (is_array($row['fields'] ?? null) ? $row['fields'] : array() as $name => $value) {
        if (isset($fields[$name]) && is_array($fields[$name])) {
            $fields[$name]['value'] = mb_substr((string) $value, 0, 1000);
        }
    }
    // the other columns of the file the user kept become text fields
    foreach (is_array($row['extra'] ?? null) ? $row['extra'] : array() as $name => $value) {
        $name = trim(mb_substr((string) $name, 0, 100));
        if ($name !== '' && !isset($fields[$name]) && trim((string) $value) !== '') {
            $fields[$name] = array('type' => 'text', 'value' => mb_substr((string) $value, 0, 1000), 'position' => count($fields) + 1);
        }
    }
    if ($register === 'both') {
        $missing = array();
        foreach ($fields as $name => $field) {
            if (is_array($field) && !empty($field['required']) && trim((string) ($field['value'] ?? '')) === '') {
                $missing[] = (string) $name;
            }
        }
        if ($missing !== array()) {
            return array('id' => null, 'reason' => 'It needs: ' . implode(', ', $missing) . '.');
        }
    }
    $Entry = new Inventory($Owner ?? $App->Users);
    $Entry->asUnregistered = $register !== 'both';
    $Entry->withPersonal = $register === 'both' || $register === 'personal';
    return array('id' => $Entry->create(title: mb_substr($title, 0, 255), category: $categoryId, metadata: json_encode(array('extra_fields' => (object) $fields), JSON_UNESCAPED_UNICODE)), 'reason' => null);
};

try {
    $isZip = isset($_FILES['file']);
    $source = $isZip ? $_POST : $payload;
    $module = $loadModule((int) ($source['category'] ?? 0));
    if ($module === null) {
        respond(404, array('error' => 'This module is not in your team.'));
    }
    $register = (string) ($source['register'] ?? 'personal');
    if (!in_array($register, array('both', 'personal', 'none'), true)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $settings = json_decode((string) $module['settings'], true);
    if ($register === 'both' && is_array($settings) && !empty($settings['requires_sequence_file']) && !$isZip) {
        respond(400, array('error' => 'The entries of this module need a sequence file to go in the lab Database: import them into your own database, attach the files, and register them.'));
    }
    $definitions = $fieldsOf($module);
    $created = array();
    $skipped = array();
    $filesAttached = 0;

    // the owner of the new entries: the user who imports, one user chosen, or the owner written in each row (matched by e-mail, then by name);
    // only admins can give entries to someone else
    $ownerMode = (string) ($source['owner_mode'] ?? 'me');
    $ownerChoice = (int) ($source['owner_user'] ?? 0);
    if ($ownerMode !== 'me' && !$isAdmin) {
        respond(403, array('error' => 'Only an admin can import entries for another owner.'));
    }
    $users = $ownerMode === 'me' ? array() : $teamUsers();
    $byEmail = array();
    $byName = array();
    foreach ($users as $user) {
        $byEmail[strtolower(trim((string) $user['email']))] = (int) $user['id'];
        $byName[strtolower(trim((string) $user['name']))] = (int) $user['id'];
    }
    $ownerUsers = array();
    $notFound = array();
    $ownerFor = static function (array $row) use ($ownerMode, $ownerChoice, $byEmail, $byName, $teamId, &$ownerUsers, &$notFound, $userId): ?Users {
        $id = 0;
        if ($ownerMode === 'user') {
            $id = $ownerChoice;
        } elseif ($ownerMode === 'column') {
            $mail = strtolower(trim((string) ($row['owner_email'] ?? '')));
            $name = strtolower(trim((string) ($row['owner'] ?? '')));
            $id = $byEmail[$mail] ?? ($byName[$name] ?? 0);
            if ($id === 0 && ($mail !== '' || $name !== '')) {
                $notFound[($mail !== '' ? $mail : $name)] = true;
            }
        }
        if ($id <= 0 || $id === $userId) {
            return null;
        }
        return $ownerUsers[$id] ??= new Users($id, $teamId);
    };

    if ($isZip) {
        // a zip of the export: entries.csv, and the files of the entries in files/<key>/
        $zip = new ZipArchive();
        if ($zip->open((string) $_FILES['file']['tmp_name']) !== true) {
            respond(400, array('error' => 'This is not a zip file.'));
        }
        $csv = $zip->getFromName('entries.csv');
        if ($csv === false) {
            respond(400, array('error' => 'The zip has no entries.csv: it has to come from an export of a module.'));
        }
        $handle = fopen('php://temp', 'w+b');
        fwrite($handle, (string) preg_replace('/^\xEF\xBB\xBF/', '', $csv));
        rewind($handle);
        $heading = fgetcsv($handle, 0, ',', '"', '') ?: array();
        $normal = static fn(string $text): string => (string) preg_replace('/[^a-z0-9]+/', '', strtolower($text));
        $byNormal = array();
        foreach ($definitions as $name => $definition) {
            $byNormal[$normal((string) $name)] = (string) $name;
        }
        $fs = Storage::EXPORTS->getStorage()->getFs();
        $tmpDir = 'registry-import-' . bin2hex(random_bytes(6));
        $count = 0;
        while (($cells = fgetcsv($handle, 0, ',', '"', '')) !== false && $count < 500) {
            $count++;
            $row = array('title' => '', 'fields' => array(), 'extra' => array());
            $key = '';
            $fileList = '';
            foreach ($heading as $index => $name) {
                $value = trim((string) ($cells[$index] ?? ''));
                $n = $normal((string) $name);
                if ($n === 'title') {
                    $row['title'] = $value;
                } elseif ($n === 'key') {
                    $key = $value;
                } elseif ($n === 'files') {
                    $fileList = $value;
                } elseif ($n === 'owner') {
                    $row['owner'] = $value;
                } elseif ($n === 'owneremail') {
                    $row['owner_email'] = $value;
                } elseif (in_array($n, array('id', 'myid', 'date', ''), true)) {
                    continue;
                } elseif (isset($byNormal[$n])) {
                    $row['fields'][$byNormal[$n]] = $value;
                } else {
                    $row['extra'][(string) $name] = $value;
                }
            }
            $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($row));
            if ($made['id'] === null) {
                $skipped[] = array('row' => 'Row ' . $count . ' (' . $row['title'] . ')', 'reason' => $made['reason']);
                continue;
            }
            $created[] = $made['id'];
            if ($key !== '' && $fileList !== '') {
                $Entry = new Inventory($App->Users, (int) $made['id']);
                foreach (explode('|', $fileList) as $fileName) {
                    $content = $zip->getFromName('files/' . $key . '/' . $fileName);
                    if ($content === false || $fileName === '') {
                        continue;
                    }
                    $path = $tmpDir . '/' . bin2hex(random_bytes(4)) . '-' . $fileName;
                    try {
                        $fs->write($path, $content);
                        $Entry->Uploads->create(new CreateUploadFromFs($fs, $fileName, $path, new FileHash($fs, $path)));
                        $filesAttached++;
                    } catch (Throwable $e) {
                        $skipped[] = array('row' => 'File ' . $fileName . ' of row ' . $count, 'reason' => $e->getMessage());
                    }
                }
            }
        }
        try {
            $fs->deleteDirectory($tmpDir);
        } catch (Throwable) {
            // the temporary files are cleaned by the exports clean-up
        }
        $zip->close();
        respond(200, array('created' => count($created), 'files' => $filesAttached, 'skipped' => $skipped, 'owners_not_found' => array_keys($notFound)));
    }

    foreach (array_slice(is_array($payload['rows'] ?? null) ? $payload['rows'] : array(), 0, 200) as $index => $row) {
        $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($row));
        if ($made['id'] === null) {
            $skipped[] = array('row' => 'Row ' . ((int) ($payload['offset'] ?? 0) + $index + 1) . ' (' . trim((string) ($row['title'] ?? '')) . ')', 'reason' => $made['reason']);
            continue;
        }
        $created[] = $made['id'];
    }
    respond(200, array('created' => count($created), 'skipped' => $skipped, 'owners_not_found' => array_keys($notFound)));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
