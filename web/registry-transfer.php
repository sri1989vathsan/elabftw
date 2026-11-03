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
use Elabftw\Enums\Action;
use Elabftw\Models\ExperimentsFolders;
use Elabftw\Enums\Storage;
use Elabftw\Hash\FileHash;
use Elabftw\Models\Inventory;
use Elabftw\Models\Users\Users;
use PDO;
use Throwable;
use ZipArchive;

use function array_column;
use function str_starts_with;
use function str_contains;
use function explode;
use function end;
use function array_pop;
use function preg_match;
use function preg_split;
use function mb_strpos;
use function mb_strlen;
use function uksort;
use function ord;
use function substr;
use function max;
use function min;
use function implode;
use function array_keys;
use function rewind;
use function stream_get_contents;
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
// the default owner of the team: who gets imported entries whose owner is not found
$defaultOwnerReq = $pdo->prepare('SELECT default_owner FROM registry_settings WHERE team = :team');
$defaultOwnerReq->bindValue(':team', $teamId, PDO::PARAM_INT);
$pdo->execute($defaultOwnerReq);
$defaultOwner = (int) $defaultOwnerReq->fetchColumn();
$teamUsers = static function () use ($pdo, $teamId): array {
    $req = $pdo->prepare('SELECT u.userid AS id, u.email, CONCAT(u.firstname, " ", u.lastname) AS name FROM users AS u INNER JOIN users2teams AS t ON t.users_id = u.userid WHERE t.teams_id = :team AND t.is_archived = 0 ORDER BY u.firstname, u.lastname');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    return $req->fetchAll();
};

// the template of a module for the import: a heading row, and a row (its first cell is #) that says what each column takes; the import skips it
$templateOf = static function (array $module) use ($fieldsOf): string {
    $definitions = $fieldsOf($module);
    $headings = array('ID', 'Title', 'Owner e-mail');
    $hints = array('# Number in the lab (optional)', 'The name of the entry (required)', 'E-mail of the owner (optional)');
    foreach ($definitions as $name => $definition) {
        $headings[] = (string) $name;
        $hint = match ((string) ($definition['type'] ?? 'text')) {
            'select', 'radio' => 'One of: ' . implode(' / ', is_array($definition['options'] ?? null) ? $definition['options'] : array()),
            'number' => 'A number' . (!empty($definition['unit']) ? ' (' . $definition['unit'] . ')' : ''),
            'date' => 'A date, like 2026-12-31',
            'checkbox' => 'on or off',
            'url' => 'A web address',
            'email' => 'An e-mail address',
            default => 'Text',
        };
        $hints[] = $hint . (!empty($definition['required']) ? ' (required)' : '');
    }
    $out = fopen('php://temp', 'w+b');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $headings, ',', '"', '');
    fputcsv($out, $hints, ',', '"', '');
    rewind($out);
    return (string) stream_get_contents($out);
};

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    // the templates of all the modules, in one zip
    if (isset($_GET['templates'])) {
        $req = $pdo->prepare('SELECT id, title, fields, settings FROM inventory_categories WHERE team = :team AND state = 1 ORDER BY ordering, title');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($req);
        $zipPath = (string) tempnam(sys_get_temp_dir(), 'regtpl');
        $zip = new ZipArchive();
        $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($req->fetchAll() as $module) {
            $zip->addFromString(strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', (string) $module['title'])) . '-template.csv', $templateOf($module));
        }
        $zip->close();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="import-templates.zip"');
        header('Content-Length: ' . filesize($zipPath));
        readfile($zipPath);
        unlink($zipPath);
        exit;
    }
    // the users that can own what is imported (admins only)
    // the folders of the Database, for the choice of the folder of entries
    if (isset($_GET['folders'])) {
        $folders = array();
        foreach (new ExperimentsFolders($App->Users, null, 'inventory')->readAll() as $folder) {
            $folders[] = array('id' => (int) $folder['id'], 'path' => (string) $folder['full_path'], 'owner' => (int) ($folder['userid'] ?? 0), 'database' => (string) $folder['full_path'] === 'Database items' || str_starts_with((string) $folder['full_path'], 'Database items > '));
        }
        respond(200, array('folders' => $folders, 'me' => $userId));
    }
    if (isset($_GET['users'])) {
        respond(200, array('users' => $isAdmin ? $teamUsers() : array(), 'is_admin' => $isAdmin, 'me' => $userId, 'default_owner' => $defaultOwner > 0 ? $defaultOwner : null));
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
        echo $templateOf($module);
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
// an admin sets who gets imported entries whose owner is not found
if (is_array($payload) && ($payload['action'] ?? '') === 'set_default_owner') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can set the default owner.'));
    }
    $chosen = (int) ($payload['owner'] ?? 0);
    $members = array_map('strval', array_column($teamUsers(), 'id'));
    if ($chosen > 0 && !in_array((string) $chosen, $members, true)) {
        respond(400, array('error' => 'Choose a user of the team.'));
    }
    $req = $pdo->prepare('INSERT INTO registry_settings (team, default_owner) VALUES (:team, :owner) ON DUPLICATE KEY UPDATE default_owner = VALUES(default_owner)');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':owner', $chosen > 0 ? $chosen : null, $chosen > 0 ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $pdo->execute($req);
    respond(200, array('ok' => true));
}

// the storage places of LabCollector, kept as text in the field "Storage (LabCollector)", become places of the storage browser: the path of rooms,
// freezers and racks, a box at the end of it, and the entry in the boxes with the positions of its vials (admins only)
if (is_array($payload) && ($payload['action'] ?? '') === 'build_storage') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can build the storage places.'));
    }
    try {
        $categoryId = (int) ($payload['category'] ?? 0);
        if ($loadModule($categoryId) === null) {
            respond(404, array('error' => 'This module is not in your team.'));
        }
        $read = $pdo->prepare('SELECT id, metadata FROM inventory WHERE category = :category AND team = :team AND state = 1 AND NOT EXISTS (SELECT 1 FROM containers2inventory AS c WHERE c.item_id = inventory.id)');
        $read->bindValue(':category', $categoryId, PDO::PARAM_INT);
        $read->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($read);
        $entries = array();
        $texts = array();
        foreach ($read->fetchAll() as $entry) {
            $meta = json_decode((string) $entry['metadata'], true);
            $value = trim((string) ($meta['extra_fields']['Storage (LabCollector)']['value'] ?? ''));
            if ($value !== '') {
                $texts[(int) $entry['id']] = $value;
            }
        }
        // the roots (first place of a path: "Instrument Room"): they tell where a second place starts inside one text
        $roots = array();
        $partsOf = static function (string $text): array {
            $parts = explode(' || ', $text);
            $extras = '';
            if ($parts !== array() && preg_match('/^(vials|volume|comment):/', (string) end($parts)) === 1) {
                $extras = (string) array_pop($parts);
            }
            return array($parts, $extras);
        };
        foreach ($texts as $text) {
            foreach ($partsOf($text)[0] as $part) {
                $first = trim(explode(' > ', explode(' | ', $part)[0])[0]);
                if ($first !== '' && str_contains($part, ' > ')) {
                    $roots[$first] = ($roots[$first] ?? 0) + 1;
                }
            }
        }
        uksort($roots, static fn(string $a, string $b): int => mb_strlen($b) <=> mb_strlen($a));
        $cleanPath = static function (string $path): array {
            $segments = array();
            foreach (explode(' > ', $path) as $segment) {
                // "(delete)" and "()" are noise; "(2)" after a name is the place of the thing inside its parent (the 2nd position of the rack), not another one
                $segment = trim((string) preg_replace('/\s*\((?:delete|\d*)\)\s*$/i', '', trim($segment)));
                if ($segment !== '') {
                    $segments[] = mb_substr($segment, 0, 255);
                }
            }
            return $segments;
        };
        $positionsOf = static function (string $raw): array {
            $found = array();
            foreach (explode(',', $raw) as $one) {
                $one = strtoupper(trim($one));
                if (preg_match('/^[A-Z]\d{1,2}$/', $one) === 1) {
                    $found[] = $one;
                }
            }
            return $found;
        };
        // every place of every entry: the path, the positions, what was written about it
        $places = array();
        $boxes = array();
        foreach ($texts as $id => $text) {
            [$parts, $extras] = $partsOf($text);
            $vials = preg_match('/vials:\s*(\d+)/', $extras, $m) === 1 ? (int) $m[1] : 0;
            foreach ($parts as $part) {
                $pieces = preg_split('/\(Position:\s*([^)]*)\)/', $part, -1, PREG_SPLIT_DELIM_CAPTURE);
                if (!is_array($pieces)) {
                    continue;
                }
                $pathText = trim(explode(' | ', (string) $pieces[0])[0]);
                $index = 1;
                do {
                    $raw = $pieces[$index] ?? '';
                    $tail = (string) ($pieces[$index + 1] ?? '');
                    // a second place can follow inside the same text: it starts where a known root starts
                    $next = '';
                    $cut = null;
                    foreach (array_keys($roots) as $root) {
                        $at = mb_strpos($tail, $root . ' > ');
                        if ($at !== false && ($cut === null || $at < $cut)) {
                            $cut = $at;
                        }
                    }
                    if ($cut !== null) {
                        $next = mb_substr($tail, $cut);
                        $tail = mb_substr($tail, 0, $cut);
                    }
                    $segments = $cleanPath($pathText);
                    if (count($segments) >= 1) {
                        $positions = $positionsOf((string) $raw);
                        $comment = preg_match('/Comments:\s*([^|]*)/', $tail, $c) === 1 ? trim($c[1]) : (preg_match('/Features:\s*([^|]*)/', $tail, $c) === 1 ? trim($c[1]) : '');
                        $places[$id][] = array('segments' => $segments, 'positions' => $positions, 'comment' => $comment);
                        $key = implode(' > ', $segments);
                        foreach ($positions as $position) {
                            $boxes[$key]['rows'] = max($boxes[$key]['rows'] ?? 0, ord($position[0]) - 64);
                            $boxes[$key]['cols'] = max($boxes[$key]['cols'] ?? 0, (int) substr($position, 1));
                        }
                    }
                    $pathText = trim(explode(' | ', $next)[0]);
                    $index += 2;
                } while ($pathText !== '' && $index < count($pieces) + 2 && $next !== '');
                $places[$id]['vials'] = $vials;
            }
        }
        // the size of a box: the smallest usual one that holds every position seen in it
        $sizes = array(array(9, 9), array(8, 12), array(10, 10), array(12, 12), array(16, 24));
        $sizeOf = static function (int $rows, int $cols) use ($sizes): array {
            foreach ($sizes as $size) {
                if ($rows <= $size[0] && $cols <= $size[1]) {
                    return $size;
                }
            }
            return array(min($rows, 26), min($cols, 99));
        };
        $unitIds = array();
        $created = 0;
        $findUnit = $pdo->prepare('SELECT id, box_rows FROM storage_units WHERE name = :name AND ((:parent IS NULL AND parent_id IS NULL) OR parent_id = :parent2) LIMIT 1');
        $makeUnit = $pdo->prepare('INSERT INTO storage_units (name, parent_id, box_rows, box_cols) VALUES (:name, :parent, :rows, :cols)');
        $setSize = $pdo->prepare('UPDATE storage_units SET box_rows = :rows, box_cols = :cols WHERE id = :id');
        $unitFor = static function (array $segments) use (&$unitIds, &$created, $findUnit, $makeUnit, $setSize, $boxes, $sizeOf, $pdo): int {
            $parent = null;
            $path = array();
            foreach ($segments as $depth => $name) {
                $path[] = $name;
                $key = implode(' > ', $path);
                $last = $depth === count($segments) - 1;
                $size = $last && isset($boxes[$key]) ? $sizeOf((int) $boxes[$key]['rows'], (int) $boxes[$key]['cols']) : null;
                if (!isset($unitIds[$key])) {
                    $findUnit->bindValue(':name', $name);
                    $findUnit->bindValue(':parent', $parent, $parent === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                    $findUnit->bindValue(':parent2', $parent, $parent === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                    $pdo->execute($findUnit);
                    $found = $findUnit->fetch();
                    if (is_array($found)) {
                        $unitIds[$key] = (int) $found['id'];
                        if ($size !== null && $found['box_rows'] === null) {
                            $setSize->bindValue(':rows', $size[0], PDO::PARAM_INT);
                            $setSize->bindValue(':cols', $size[1], PDO::PARAM_INT);
                            $setSize->bindValue(':id', $unitIds[$key], PDO::PARAM_INT);
                            $pdo->execute($setSize);
                        }
                    } else {
                        $makeUnit->bindValue(':name', $name);
                        $makeUnit->bindValue(':parent', $parent, $parent === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                        $makeUnit->bindValue(':rows', $size[0] ?? null, $size === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                        $makeUnit->bindValue(':cols', $size[1] ?? null, $size === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                        $pdo->execute($makeUnit);
                        $unitIds[$key] = (int) $pdo->lastInsertId();
                        $created++;
                    }
                }
                $parent = $unitIds[$key];
            }
            return (int) $parent;
        };
        $link = $pdo->prepare('INSERT INTO containers2inventory (storage_id, item_id, qty_stored, qty_unit, position, is_primary, comment) VALUES (:storage, :item, :qty, :unit, :position, :primary, :comment)');
        $linked = 0;
        $rowsMade = 0;
        foreach ($places as $id => $list) {
            $vials = (int) ($list['vials'] ?? 0);
            unset($list['vials']);
            $first = true;
            $single = count($list) === 1;
            foreach ($list as $place) {
                $storage = $unitFor($place['segments']);
                $targets = $place['positions'] === array() ? array(null) : $place['positions'];
                foreach ($targets as $position) {
                    $link->bindValue(':storage', $storage, PDO::PARAM_INT);
                    $link->bindValue(':item', $id, PDO::PARAM_INT);
                    $link->bindValue(':qty', $position === null && $single && $vials > 0 ? $vials : 1, PDO::PARAM_INT);
                    $link->bindValue(':unit', 'vial');
                    $link->bindValue(':position', $position, $position === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                    $link->bindValue(':primary', $first ? 1 : 0, PDO::PARAM_INT);
                    $link->bindValue(':comment', $place['comment'] === '' ? null : mb_substr($place['comment'], 0, 255), $place['comment'] === '' ? PDO::PARAM_NULL : PDO::PARAM_STR);
                    try {
                        $pdo->execute($link);
                    } catch (Throwable) {
                        // the slot is held by another entry (LabCollector lists two entries at one position): the entry is put in the box without a slot
                        $link->bindValue(':position', null, PDO::PARAM_NULL);
                        $link->bindValue(':comment', mb_substr(trim('LabCollector position ' . $position . ' is also used by another entry. ' . $place['comment']), 0, 255));
                        $pdo->execute($link);
                    }
                    $first = false;
                    $rowsMade++;
                }
            }
            $linked++;
        }
        respond(200, array('entries_with_storage' => $linked, 'places_created' => $created, 'vials_placed' => $rowsMade, 'texts' => count($texts)));
    } catch (Throwable $e) {
        respond(500, array('error' => 'Could not build the storage places: ' . $e->getMessage()));
    }
}

// empty a storage place (the entries stored in it are unlinked, they are kept), or delete it with everything inside it (admins only);
// with count_only the numbers are given first, so the user can confirm them
if (is_array($payload) && ($payload['action'] ?? '') === 'empty_storage') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can empty or delete storage places.'));
    }
    try {
        $rootId = (int) ($payload['id'] ?? 0);
        $delete = !empty($payload['delete']);
        $withChildren = $delete || !empty($payload['include_children']);
        $run = static function (string $sql) use ($pdo): \PDOStatement {
            $statement = $pdo->prepare($sql);
            $pdo->execute($statement);
            return $statement;
        };
        $all = $run('SELECT id, parent_id FROM storage_units')->fetchAll();
        $byParent = array();
        $known = array();
        foreach ($all as $unit) {
            $known[(int) $unit['id']] = true;
            $byParent[(int) ($unit['parent_id'] ?? 0)][] = (int) $unit['id'];
        }
        if (!isset($known[$rootId])) {
            respond(404, array('error' => 'This storage place does not exist.'));
        }
        // the place, and the places inside it when they are included (the deepest last in the list, so they are deleted first)
        $ids = array($rootId);
        if ($withChildren) {
            for ($i = 0; $i < count($ids); $i++) {
                foreach ($byParent[$ids[$i]] ?? array() as $child) {
                    $ids[] = $child;
                }
            }
        }
        $in = implode(',', array_map('intval', $ids));
        $links = (int) $run('SELECT COUNT(*) FROM containers2inventory WHERE storage_id IN (' . $in . ')')->fetchColumn();
        $entries = (int) $run('SELECT COUNT(DISTINCT item_id) FROM containers2inventory WHERE storage_id IN (' . $in . ')')->fetchColumn();
        $others = 0;
        foreach (array('containers2experiments', 'containers2experiments_templates', 'containers2items', 'containers2items_types') as $table) {
            $others += (int) $run('SELECT COUNT(*) FROM ' . $table . ' WHERE storage_id IN (' . $in . ')')->fetchColumn();
        }
        if (!empty($payload['count_only'])) {
            respond(200, array('places' => count($ids), 'entries' => $entries, 'links' => $links, 'other_links' => $others));
        }
        if ($delete && $others > 0) {
            respond(409, array('error' => 'Something other than Database entries (an experiment or a resource) is stored here: remove that first.'));
        }
        $run('DELETE FROM containers2inventory WHERE storage_id IN (' . $in . ')');
        if ($delete) {
            foreach (array_reverse($ids) as $unitId) {
                $run('DELETE FROM storage_units WHERE id = ' . (int) $unitId);
            }
        }
        respond(200, array('places' => count($ids), 'entries' => $entries, 'links' => $links, 'deleted' => $delete));
    } catch (Throwable $e) {
        respond(500, array('error' => 'Could not do it: ' . $e->getMessage()));
    }
}

// the entries that were ticked move to another folder (or to none): each one needs the right to edit it
if (is_array($payload) && ($payload['action'] ?? '') === 'move_to_folder') {
    try {
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', is_array($payload['ids'] ?? null) ? $payload['ids'] : array()), static fn(int $n): bool => $n > 0))), 0, 500);
        $folderId = (int) ($payload['folder_id'] ?? 0);
        if ($ids === array()) {
            respond(400, array('error' => 'Choose entries.'));
        }
        $known = array_column((new ExperimentsFolders($App->Users, null, 'inventory'))->readAll(), 'id');
        if ($folderId > 0 && !in_array((string) $folderId, array_map('strval', $known), true)) {
            respond(400, array('error' => 'This folder does not exist.'));
        }
        $moved = 0;
        $refused = array();
        foreach ($ids as $id) {
            try {
                $Entry = new Inventory($App->Users, $id);
                $Entry->patch(Action::Update, array('folder_id' => $folderId > 0 ? (string) $folderId : ''));
                $moved++;
            } catch (Throwable) {
                $refused[] = $id;
            }
        }
        respond(200, array('moved' => $moved, 'refused' => $refused));
    } catch (Throwable $e) {
        respond(500, array('error' => 'Could not move the entries: ' . $e->getMessage()));
    }
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
$makeEntry = static function (array $row, int $categoryId, array $definitions, string $register, ?Users $Owner = null, bool $keepNumber = false) use ($App, $pdo, $teamId): array {
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
    // the number of the file becomes the lab number (the entry keeps the number it had before); a number that is taken is not used twice
    $number = null;
    if ($keepNumber && $register === 'both') {
        $wanted = (int) preg_replace('/\D+/', '', (string) ($row['number'] ?? ''));
        if ($wanted > 0) {
            $taken = $pdo->prepare('SELECT COUNT(*) FROM inventory WHERE category = :category AND custom_id = :number AND team = :team');
            $taken->bindValue(':category', $categoryId, PDO::PARAM_INT);
            $taken->bindValue(':number', $wanted, PDO::PARAM_INT);
            $taken->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($taken);
            if ((int) $taken->fetchColumn() > 0) {
                return array('id' => null, 'reason' => 'The number ' . $wanted . ' is already used in this module.');
            }
            $number = $wanted;
        }
    }
    $Entry = new Inventory($Owner ?? $App->Users);
    $Entry->asUnregistered = $register !== 'both';
    $Entry->withPersonal = $register === 'both' || $register === 'personal';
    $newId = $Entry->create(title: mb_substr($title, 0, 255), category: $categoryId, customId: $number, metadata: json_encode(array('extra_fields' => (object) $fields), JSON_UNESCAPED_UNICODE));
    // the entries of a shared account of LabCollector ("Wild Card") belong to the whole team: everyone can edit them
    if (in_array(strtolower(trim((string) ($row['owner'] ?? ''))), array('wild card'), true)) {
        $open = $pdo->prepare('UPDATE inventory SET canwrite_base = 30 WHERE id = :id');
        $open->bindValue(':id', $newId, PDO::PARAM_INT);
        $pdo->execute($open);
    }
    return array('id' => $newId, 'reason' => null);
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
    $keepNumbers = !empty($source['keep_numbers']) && $source['keep_numbers'] !== '0';
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
    $ownerFor = static function (array $row) use ($ownerMode, $ownerChoice, $defaultOwner, $byEmail, $byName, $teamId, &$ownerUsers, &$notFound, $userId): ?Users {
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
        // an owner that is not found: the user chosen for those rows, else the one who imports
        if ($ownerMode === 'column' && $id === 0) {
            $id = $ownerChoice > 0 ? $ownerChoice : $defaultOwner;
        }
        if ($id <= 0 || $id === $userId) {
            return null;
        }
        return $ownerUsers[$id] ??= new Users($id, $teamId);
    };

    if ($isZip) {
        @set_time_limit(0);
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
        while (($cells = fgetcsv($handle, 0, ',', '"', '')) !== false && $count < 5000) {
            // the row of hints of a template starts with #
            if (isset($cells[0]) && str_starts_with(trim((string) $cells[0]), '#')) {
                continue;
            }
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
                } elseif ($n === 'id') {
                    $row['number'] = $value;
                } elseif (in_array($n, array('myid', 'date', ''), true)) {
                    continue;
                } elseif (isset($byNormal[$n])) {
                    $row['fields'][$byNormal[$n]] = $value;
                } else {
                    $row['extra'][(string) $name] = $value;
                }
            }
            $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($row), $keepNumbers);
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
        $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($row), $keepNumbers);
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
