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

use Elabftw\Elabftw\Backbone;
use Elabftw\Elabftw\CreateUploadFromFs;
use Elabftw\Elabftw\GenbankPrimers;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\Action;
use Elabftw\Models\ExperimentsFolders;
use Elabftw\Enums\Storage;
use Elabftw\Hash\FileHash;
use Elabftw\Models\Inventory;
use Elabftw\Models\Users\Users;
use ZipStream\ZipStream;
use PDO;
use Throwable;
use ZipArchive;

use function array_column;
use function array_diff;
use function base64_decode;
use function strlen;
use function array_filter;
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
 * POST {category, register: both|lab|personal|none, rows: [{title, fields: {name: value}, extra: {name: value}}]} makes the entries
 * (up to 200 at a time); an entry that cannot be made is listed with the reason.
 */
require_once __DIR__ . '/app/init.inc.php';
require_once __DIR__ . '/sequence-viewer/genbank-primers.inc.php';
require_once __DIR__ . '/ai-features.inc.php';
require_once __DIR__ . '/backbone.inc.php';

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

// a name as its words, lower case, without what is in brackets, in alphabetical order: "Jan Michler" and "Michler, Jan" are the same
$nameTokens = static function (string $name): array {
    $name = strtolower((string) preg_replace('/\([^)]*\)/', ' ', $name));
    $tokens = preg_split('/[^\p{L}]+/u', $name, -1, PREG_SPLIT_NO_EMPTY) ?: array();
    sort($tokens);
    return $tokens;
};
// the matching saved by an admin: LabCollector e-mail or name to the user of the team (found by the e-mail, then by the name, of the user written
// in the match: the user can have been made after it was saved)
$ownerMapRows = static function () use ($pdo, $teamId, $nameTokens): array {
    $req = $pdo->prepare('SELECT lc_name, lc_email, elab_name, elab_email, editors FROM registry_owner_map WHERE team = :team');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    return $req->fetchAll();
};
// the "LabCollector owner" field of an entry ("Name <e-mail>") as a name and an e-mail address
$lcOwnerSql = 'JSON_UNQUOTE(JSON_EXTRACT(metadata, \'$.extra_fields."LabCollector owner".value\'))';
$parseLcOwner = static function (string $value): array {
    $value = trim($value);
    if (preg_match('/^(.*?)\s*<([^>]*)>\s*$/u', $value, $found) === 1) {
        return array('name' => trim($found[1]), 'email' => strtolower(trim($found[2])));
    }
    return array('name' => $value, 'email' => '');
};
// the entries get a new owner: each is renumbered in the list of the new owner, so My ID stays their own count
$reassign = static function (array $ids, int $ownerId) use ($pdo, $teamId): int {
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
    return $changed;
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
    // the matching of the people of LabCollector to the users of eLabFTW that an admin saved
    if (isset($_GET['owner_map'])) {
        if (!$isAdmin) {
            respond(403, array('error' => 'Only an admin can match the owners.'));
        }
        $req = $pdo->prepare('SELECT lc_name, lc_email, elab_name, elab_email, editors FROM registry_owner_map WHERE team = :team ORDER BY lc_name, lc_email');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($req);
        $pairs = $req->fetchAll();
        // the people found in the entries (their "LabCollector owner" field), so the list of LabCollector does not have to be pasted
        $seen = array();
        $people = array();
        $found = $pdo->prepare('SELECT DISTINCT ' . $lcOwnerSql . ' AS owner FROM inventory WHERE team = :team AND state = 1');
        $found->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($found);
        foreach ($found->fetchAll(PDO::FETCH_COLUMN) as $value) {
            $person = $parseLcOwner((string) $value);
            if ($person['name'] === '' && $person['email'] === '') {
                continue;
            }
            $key = $person['email'] !== '' ? $person['email'] : implode(' ', $nameTokens($person['name']));
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $people[] = $person;
            }
        }
        usort($people, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
        // the user groups of the team: a match can also name the people who may edit the entries of this person
        $groupReq = $pdo->prepare('SELECT g.id, g.name FROM team_groups AS g WHERE g.team = :team AND (g.owner IS NULL OR g.owner = ' . (int) $userId . ' OR EXISTS (SELECT 1 FROM users2team_groups AS vm WHERE vm.groupid = g.id AND vm.userid = ' . (int) $userId . ')) ORDER BY g.name');
        $groupReq->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($groupReq);
        respond(200, array('pairs' => $pairs, 'users' => $teamUsers(), 'people' => $people, 'groups' => $groupReq->fetchAll()));
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
    // one query for the files of all entries (it was one per entry)
    $uploadsByEntry = array();
    if ($asZip && $entries !== array()) {
        $entryIds = implode(',', array_map('intval', array_column($entries, 'id')));
        $uploadsReq = $pdo->query("SELECT item_id, real_name, long_name, storage FROM uploads WHERE type = 'inventory' AND state = 1 AND item_id IN ($entryIds) ORDER BY id");
        foreach ($uploadsReq->fetchAll() as $upload) {
            $uploadsByEntry[(int) $upload['item_id']][] = $upload;
        }
    }
    foreach ($entries as $index => $entry) {
        $row = array((string) ($entry['custom_id'] ?? ''), (string) ($entry['personal_id'] ?? ''), (string) $entry['title'], (string) $entry['date'], (string) $entry['owner'], (string) ($entry['owner_email'] ?? ''));
        foreach (array_keys($names) as $name) {
            $value = $decodedEntries[$index][$name]['value'] ?? '';
            $row[] = is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value;
        }
        if ($asZip) {
            // the attached files go in the folder files/<key>/ of the zip (their list was read for all entries at once above)
            $key = (string) ($index + 1);
            $fileNames = array();
            foreach ($uploadsByEntry[(int) $entry['id']] ?? array() as $upload) {
                $real = (string) preg_replace('/[\/\\\\]+/', '_', (string) $upload['real_name']);
                // a name used twice in one entry: the later file replaces the earlier one, as before
                $zipFiles['files/' . $key . '/' . $real] = array('long_name' => (string) $upload['long_name'], 'storage' => (int) $upload['storage']);
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
    // a zip: entries.csv and the files of the entries. It is streamed to the browser, one file at a time, so that memory does not grow with the size of the files
    $csv = fopen('php://temp', 'w+b');
    fwrite($csv, "\xEF\xBB\xBF");
    fputcsv($csv, $heading, ',', '"', '');
    foreach ($rows as $row) {
        fputcsv($csv, $row, ',', '"', '');
    }
    rewind($csv);
    @set_time_limit(0);
    $zip = new ZipStream(sendHttpHeaders: true, outputName: $fileName . '.zip', contentType: 'application/zip');
    $zip->addFileFromStream('entries.csv', $csv);
    foreach ($zipFiles as $path => $file) {
        try {
            $stream = Storage::from($file['storage'])->getStorage()->getFs()->readStream($file['long_name']);
            $zip->addFileFromStream($path, $stream);
            fclose($stream);
        } catch (Throwable) {
            // a file that cannot be read is left out
        }
    }
    $zip->finish();
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
                $segment = trim((string) preg_replace('/\s*\((?:delete|\d*)\)\s*$/i', '', rtrim(trim($segment), ' >')));
                if ($segment !== '') {
                    $segments[] = mb_substr($segment, 0, 255);
                }
            }
            return $segments;
        };
        // "rack_3 (4) > Moor 3-4": the 4 after the name of the rack is the position of the box in the rack
        $orderOf = static function (string $path): array {
            $order = array();
            $previous = null;
            foreach (explode(' > ', $path) as $segment) {
                $segment = trim($segment);
                if ($segment === '' || preg_match('/^\(?(?:delete)\)?$/i', $segment) === 1) {
                    continue;
                }
                $order[] = $previous;
                $previous = preg_match('/\((\d+)\)\s*$/', $segment, $found) === 1 ? (int) $found[1] : null;
            }
            return $order;
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
                        $places[$id][] = array('segments' => $segments, 'order' => $orderOf($pathText), 'positions' => $positions, 'comment' => $comment);
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
        $findUnit = $pdo->prepare('SELECT id, box_rows, position FROM storage_units WHERE name = :name AND owner_id IS NULL AND ((:parent IS NULL AND parent_id IS NULL) OR parent_id = :parent2) LIMIT 1');
        $makeUnit = $pdo->prepare('INSERT INTO storage_units (name, parent_id, box_rows, box_cols, position, kind, temperature) VALUES (:name, :parent, :rows, :cols, :position, :kind, :temperature)');
        $setSize = $pdo->prepare('UPDATE storage_units SET box_rows = :rows, box_cols = :cols WHERE id = :id');
        // what each place of a path is: the first is a location; a name with "freezer", "-80", "tank" ... is a freezer, with "fridge" or "4 C" a fridge
        // (with its temperature); what comes before it is a location too, what follows is a rack, and the last one with slots is a box
        $kindsOf = static function (array $segments, bool $leafIsBox): array {
            $found = false;
            $out = array();
            foreach ($segments as $depth => $name) {
                $kind = 'location';
                $temperature = null;
                if ($found) {
                    $kind = 'rack';
                } elseif ($depth > 0 && preg_match('/fridge|refrigerat|cold ?room|4\s*(?:°)?\s*c\b/i', $name) === 1) {
                    $kind = 'fridge';
                    $temperature = 4;
                    $found = true;
                } elseif ($depth > 0 && preg_match('/freez|ln2|tank|dewar|-\s*\d{2,3}\s*(?:°)?\s*c?\b/i', $name) === 1) {
                    $kind = 'freezer';
                    $temperature = preg_match('/(-\s*\d{1,3})\s*(?:°)?\s*c?\b/i', $name, $t) === 1 ? (int) str_replace(' ', '', $t[1]) : (preg_match('/ln2|tank|dewar/i', $name) === 1 ? -196 : null);
                    $found = true;
                }
                $out[$depth] = array($kind, $temperature);
            }
            if ($leafIsBox && $segments !== array()) {
                $out[count($segments) - 1] = array('box', null);
            }
            return $out;
        };
        $setKindIfEmpty = $pdo->prepare('UPDATE storage_units SET kind = :kind, temperature = :temperature WHERE id = :id AND kind IS NULL');
        $setOrder = $pdo->prepare('UPDATE storage_units SET position = :position WHERE id = :id AND position IS NULL');
        $unitFor = static function (array $segments, array $order = array()) use (&$unitIds, &$created, $findUnit, $makeUnit, $setSize, $setOrder, $setKindIfEmpty, $kindsOf, $boxes, $sizeOf, $pdo): int {
            $parent = null;
            $path = array();
            $leafKey = implode(' > ', $segments);
            $kinds = $kindsOf($segments, isset($boxes[$leafKey]));
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
                        if (($kinds[$depth][0] ?? null) !== null) {
                            $setKindIfEmpty->bindValue(':kind', $kinds[$depth][0]);
                            $setKindIfEmpty->bindValue(':temperature', $kinds[$depth][1] ?? null, ($kinds[$depth][1] ?? null) === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                            $setKindIfEmpty->bindValue(':id', $found['id'], PDO::PARAM_INT);
                            $pdo->execute($setKindIfEmpty);
                        }
                        if (($order[$depth] ?? null) !== null && $found['position'] === null) {
                            $setOrder->bindValue(':position', $order[$depth], PDO::PARAM_INT);
                            $setOrder->bindValue(':id', $unitIds[$key], PDO::PARAM_INT);
                            $pdo->execute($setOrder);
                        }
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
                        $makeUnit->bindValue(':position', $order[$depth] ?? null, ($order[$depth] ?? null) === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                        $makeUnit->bindValue(':kind', $kinds[$depth][0] ?? null, ($kinds[$depth][0] ?? null) === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                        $makeUnit->bindValue(':temperature', $kinds[$depth][1] ?? null, ($kinds[$depth][1] ?? null) === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
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
                $storage = $unitFor($place['segments'], $place['order'] ?? array());
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

// the minimum stock of an entry: below it, the dashboard and the lists warn (the owner of the entry and the admins set it)
if (is_array($payload) && ($payload['action'] ?? '') === 'set_min_stock') {
    try {
        $entryId = (int) ($payload['id'] ?? 0);
        $Entry = new Inventory($App->Users, $entryId);
        if (!$isAdmin && (int) ($Entry->entityData['userid'] ?? 0) !== $userId) {
            respond(403, array('error' => 'Only the owner of an entry or an admin can set its minimum stock.'));
        }
        $minimum = trim((string) ($payload['min_stock'] ?? ''));
        $unit = mb_substr(trim((string) ($payload['unit'] ?? '')), 0, 20);
        $set = $pdo->prepare('UPDATE inventory SET min_stock = :minimum, min_stock_unit = :unit WHERE id = :id AND team = :team');
        $set->bindValue(':minimum', $minimum === '' || !is_numeric($minimum) || (float) $minimum < 0 ? null : (float) $minimum, $minimum === '' || !is_numeric($minimum) || (float) $minimum < 0 ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $set->bindValue(':unit', $minimum === '' || $unit === '' ? null : $unit, $minimum === '' || $unit === '' ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $set->bindValue(':id', $entryId, PDO::PARAM_INT);
        $set->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($set);
        respond(200, array('ok' => true));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage()));
    }
}

// the entries that were ticked get another owner (admins only): each is renumbered in the list of the new owner, so My ID stays their own count
if (is_array($payload) && ($payload['action'] ?? '') === 'assign_owner') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can assign the owner of entries.'));
    }
    try {
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', is_array($payload['ids'] ?? null) ? $payload['ids'] : array()), static fn(int $n): bool => $n > 0))), 0, 500);
        // the entries of a personal module stay with their owner
        if ($ids !== array()) {
            $personal = $pdo->query('SELECT i.id FROM inventory AS i INNER JOIN inventory_categories AS c ON c.id = i.category WHERE c.owner IS NOT NULL AND i.id IN (' . implode(',', $ids) . ')')->fetchAll(PDO::FETCH_COLUMN);
            $ids = array_values(array_diff($ids, array_map('intval', $personal)));
        }
        $ownerId = (int) ($payload['owner'] ?? 0);
        $members = array_column($teamUsers(), 'id');
        // the new owner can be given by e-mail address: the user of the team who has it
        $ownerEmail = strtolower(trim((string) ($payload['owner_email'] ?? '')));
        if ($ownerEmail !== '') {
            $ownerId = 0;
            foreach ($teamUsers() as $member) {
                if (strtolower(trim((string) $member['email'])) === $ownerEmail) {
                    $ownerId = (int) $member['id'];
                }
            }
            if ($ownerId === 0) {
                respond(400, array('error' => 'Nobody in the team has the e-mail address ' . $ownerEmail . '.'));
            }
        }
        // "open for all the users": everyone of the team can edit the entries (with or without a new owner)
        $open = !empty($payload['open']);
        $noOwner = $open && $ownerId === 0 && $ownerEmail === '';
        if ($ids === array() || (!$noOwner && !in_array((string) $ownerId, array_map('strval', $members), true))) {
            respond(400, array('error' => 'Choose entries and an owner of the team.'));
        }
        $changed = $noOwner ? 0 : $reassign($ids, $ownerId);
        $opened = 0;
        if ($open) {
            $setOpen = $pdo->prepare('UPDATE inventory SET canwrite_base = 30 WHERE team = :team AND state = 1 AND canwrite_base < 30 AND id IN (' . implode(',', $ids) . ')');
            $setOpen->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($setOpen);
            $opened = $setOpen->rowCount();
        }
        respond(200, array('changed' => $changed, 'opened' => $opened));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage()));
    }
}

// the matching of the people of LabCollector to the users of eLabFTW is saved (admins only): it replaces the one saved before
if (is_array($payload) && ($payload['action'] ?? '') === 'save_owner_map') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can match the owners.'));
    }
    try {
        $pdo->beginTransaction();
        $drop = $pdo->prepare('DELETE FROM registry_owner_map WHERE team = :team');
        $drop->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($drop);
        $add = $pdo->prepare('INSERT INTO registry_owner_map (team, lc_name, lc_email, elab_name, elab_email, editors) VALUES (:team, :lcn, :lce, :en, :ee, :ed)');
        $saved = 0;
        foreach (array_slice(is_array($payload['pairs'] ?? null) ? $payload['pairs'] : array(), 0, 2000) as $pair) {
            $lcName = mb_substr(trim((string) ($pair['lc_name'] ?? '')), 0, 255);
            $lcEmail = mb_substr(strtolower(trim((string) ($pair['lc_email'] ?? ''))), 0, 255);
            $elabName = mb_substr(trim((string) ($pair['elab_name'] ?? '')), 0, 255);
            $elabEmail = mb_substr(strtolower(trim((string) ($pair['elab_email'] ?? ''))), 0, 255);
            if (($lcName === '' && $lcEmail === '') || ($elabName === '' && $elabEmail === '')) {
                continue;
            }
            $add->bindValue(':team', $teamId, PDO::PARAM_INT);
            $add->bindValue(':lcn', $lcName);
            $add->bindValue(':lce', $lcEmail);
            $add->bindValue(':en', $elabName);
            $add->bindValue(':ee', $elabEmail);
            // who may also edit their entries: users and user groups of this team, as JSON
            $editorIds = static fn(mixed $list): array => array_values(array_unique(array_filter(array_map('intval', is_array($list) ? $list : array()), static fn(int $n): bool => $n > 0)));
            $editors = is_array($pair['editors'] ?? null) ? array('users' => $editorIds($pair['editors']['users'] ?? null), 'teamgroups' => $editorIds($pair['editors']['teamgroups'] ?? null)) : null;
            $add->bindValue(':ed', $editors !== null && ($editors['users'] !== array() || $editors['teamgroups'] !== array()) ? json_encode($editors) : null);
            $pdo->execute($add);
            $saved++;
        }
        $pdo->commit();
        respond(200, array('saved' => $saved));
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        respond(400, array('error' => $e->getMessage()));
    }
}

// the people and groups of $editors ({users: [...], teamgroups: [...]}) may also edit the entries $ids (added to the ones who can already; the owner is not touched)
$shareWith = static function (array $ids, array $editors) use ($pdo, $teamId): int {
    $users = array_values(array_unique(array_map('intval', (array) ($editors['users'] ?? array()))));
    $groups = array_values(array_unique(array_map('intval', (array) ($editors['teamgroups'] ?? array()))));
    if (($users === array() && $groups === array()) || $ids === array()) {
        return 0;
    }
    $norm = static function (mixed $json): array {
        $p = is_string($json) ? (json_decode($json, true) ?? array()) : array();
        $out = array();
        foreach (array('teams', 'teamgroups', 'users') as $k) {
            $out[$k] = array_values(array_unique(array_map('intval', (array) ($p[$k] ?? array()))));
        }
        return $out;
    };
    $changed = 0;
    foreach (array_chunk(array_values(array_unique($ids)), 500) as $chunk) {
        $read = $pdo->prepare('SELECT id, canread, canwrite FROM inventory WHERE team = :team AND id IN (' . implode(',', array_map('intval', $chunk)) . ')');
        $read->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($read);
        $write = $pdo->prepare('UPDATE inventory SET canread = :cr, canwrite = :cw WHERE id = :id');
        foreach ($read->fetchAll() as $e) {
            $cw = $norm($e['canwrite']);
            $cr = $norm($e['canread']);
            $before = json_encode(array($cw, $cr));
            $cw['users'] = array_values(array_unique(array_merge($cw['users'], $users)));
            $cw['teamgroups'] = array_values(array_unique(array_merge($cw['teamgroups'], $groups)));
            $cr['users'] = array_values(array_unique(array_merge($cr['users'], $cw['users'])));
            $cr['teamgroups'] = array_values(array_unique(array_merge($cr['teamgroups'], $cw['teamgroups'])));
            if (json_encode(array($cw, $cr)) === $before) {
                continue;
            }
            $write->bindValue(':cr', json_encode($cr));
            $write->bindValue(':cw', json_encode($cw));
            $write->bindValue(':id', (int) $e['id'], PDO::PARAM_INT);
            $pdo->execute($write);
            $changed++;
        }
    }
    return $changed;
};

// the saved matching is applied to the entries that exist (admins only): each goes to the user matched to its LabCollector owner; the entries of
// Wild Card are opened for all the users. With dry_run, only what would change is counted
if (is_array($payload) && ($payload['action'] ?? '') === 'apply_owner_map') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can change the owners.'));
    }
    try {
        $members = $teamUsers();
        $memberByMail = array();
        $memberByName = array();
        foreach ($members as $member) {
            if (trim((string) $member['email']) !== '') {
                $memberByMail[strtolower(trim((string) $member['email']))] = $member;
            }
            $memberByName[implode(' ', $nameTokens((string) $member['name']))] = $member;
        }
        $byLcMail = array();
        $byLcName = array();
        // people matched to "open for all the users" (written as * in the match): their entries are opened, not given to someone
        $openMail = array();
        $openName = array();
        foreach ($ownerMapRows() as $pair) {
            if ($pair['elab_name'] === '*') {
                if ($pair['lc_email'] !== '') {
                    $openMail[strtolower($pair['lc_email'])] = true;
                }
                if ($pair['lc_name'] !== '') {
                    $openName[implode(' ', $nameTokens((string) $pair['lc_name']))] = true;
                }
                continue;
            }
            $target = $memberByMail[strtolower((string) $pair['elab_email'])] ?? $memberByName[implode(' ', $nameTokens((string) $pair['elab_name']))] ?? null;
            if ($target === null) {
                continue;
            }
            // the people who may also edit the entries of this person (saved with the match)
            $target['editors'] = json_decode((string) ($pair['editors'] ?? ''), true) ?: null;
            if ($pair['lc_email'] !== '') {
                $byLcMail[strtolower($pair['lc_email'])] = $target;
            }
            if ($pair['lc_name'] !== '') {
                $byLcName[implode(' ', $nameTokens((string) $pair['lc_name']))] = $target;
            }
        }
        $read = $pdo->prepare('SELECT inventory.id, inventory.title, inventory.userid, inventory.canwrite_base, ' . str_replace('metadata', 'inventory.metadata', $lcOwnerSql) . ' AS owner, COALESCE(c.title, "") AS module FROM inventory LEFT JOIN inventory_categories AS c ON c.id = inventory.category WHERE inventory.team = :team AND inventory.state = 1');
        $read->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($read);
        // only the entries that were ticked (the others of the preview stay as they are)
        $only = is_array($payload['ids'] ?? null) ? array_flip(array_map('intval', $payload['ids'])) : null;
        $titles = array();
        $moves = array();
        $wild = array();
        $unmatched = array();
        $already = 0;
        $share = array();
        foreach ($read->fetchAll() as $entry) {
            $person = $parseLcOwner((string) $entry['owner']);
            if ($person['name'] === '' && $person['email'] === '') {
                continue;
            }
            if ($only !== null && !isset($only[(int) $entry['id']])) {
                continue;
            }
            $titles[(int) $entry['id']] = array('title' => (string) $entry['title'], 'module' => (string) $entry['module']);
            if (strtolower($person['name']) === 'wild card' || isset($openMail[$person['email']]) || isset($openName[implode(' ', $nameTokens($person['name']))])) {
                if ((int) $entry['canwrite_base'] < 30) {
                    $wild[] = (int) $entry['id'];
                }
                continue;
            }
            $target = $byLcMail[$person['email']] ?? $byLcName[implode(' ', $nameTokens($person['name']))] ?? null;
            if ($target === null) {
                $label = $person['name'] . ($person['email'] !== '' ? ' <' . $person['email'] . '>' : '');
                $unmatched[$label] = ($unmatched[$label] ?? 0) + 1;
                continue;
            }
            if (!empty($target['editors'])) {
                $share[(int) $target['id']]['editors'] = $target['editors'];
                $share[(int) $target['id']]['ids'][] = (int) $entry['id'];
            }
            if ((int) $entry['userid'] === (int) $target['id']) {
                $already++;
                continue;
            }
            $key = (int) $target['id'];
            $moves[$key] ??= array('user' => $target['name'], 'ids' => array());
            $moves[$key]['ids'][] = (int) $entry['id'];
        }
        $summary = array_map(static fn(array $move): array => array('user' => $move['user'], 'entries' => count($move['ids']), 'items' => array_map(static fn(int $id): array => array('id' => $id, 'title' => $titles[$id]['title'] ?? '', 'module' => $titles[$id]['module'] ?? ''), $move['ids'])), array_values($moves));
        $wildItems = array_map(static fn(int $id): array => array('id' => $id, 'title' => $titles[$id]['title'] ?? '', 'module' => $titles[$id]['module'] ?? ''), $wild);
        if (empty($payload['dry_run'])) {
            $changed = 0;
            foreach ($moves as $ownerId => $move) {
                $changed += $reassign($move['ids'], (int) $ownerId);
            }
            foreach (array_chunk($wild, 500) as $chunk) {
                $open = $pdo->prepare('UPDATE inventory SET canwrite_base = 30 WHERE team = :team AND id IN (' . implode(',', $chunk) . ')');
                $open->bindValue(':team', $teamId, PDO::PARAM_INT);
                $pdo->execute($open);
            }
            // besides the owner: the people and groups saved with the match may also edit the entries (added to the ones that can already)
            $shared = 0;
            foreach ($share as $group) {
                $shared += $shareWith($group['ids'], $group['editors']);
            }
            respond(200, array('changed' => $changed, 'opened' => count($wild), 'shared' => $shared, 'already' => $already, 'unmatched' => $unmatched, 'moves' => $summary));
        }
        respond(200, array('would_change' => array_sum(array_column($summary, 'entries')), 'would_open' => count($wild), 'would_share' => array_sum(array_map(static fn(array $g): int => count($g['ids']), $share)), 'wild_items' => $wildItems, 'already' => $already, 'unmatched' => $unmatched, 'moves' => $summary));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage()));
    }
}

// the people matched to "open for all the users" (by e-mail or by name): the entries they own in the file are opened at the import
$openKeys = array();

// the Backbone of a plasmid is filled in from its sequence file when the field is empty (what the lab knows of its backbones, see backbone.inc.php);
// $backbones lists what was filled and how many were not clear enough, for the answer
$backbones = array('filled' => array(), 'unclear' => 0);
$backboneFinder = null;
$fillBackbone = static function (int $entryId, string $fileName, string $content, string $title) use ($App, $pdo, $teamId, &$backbones, &$backboneFinder): void {
    if (preg_match('/\.(gb|gbk|gbff|genbank|ape|fasta|fa)$/i', $fileName) !== 1) {
        return;
    }
    try {
        $backboneFinder ??= new Backbone($pdo, $teamId);
        $done = $backboneFinder->fill(new Inventory($App->Users, $entryId), $entryId, $content);
        if ($done['filled']) {
            $backbones['filled'][] = array('title' => $title, 'backbone' => $done['backbone']);
        } elseif ($done['reason'] !== 'It is not a plasmid.' && $done['reason'] !== 'There is a Backbone already.' && $done['reason'] !== 'The module has no Backbone field.') {
            $backbones['unclear']++;
        }
    } catch (Throwable $e) {
        // the Backbone is a help: an import goes on without it (the reason is in the answer)
        $backbones['error'] = $e->getMessage();
    }
};

// one row of a file becomes an entry of the module; returns the id, or the reason it was not made
// The entries that went into the lab Database are locked when everything of the request is done (their files and their place were added
// first): the owner and the admins can unlock them by hand. An entry that is only in My entries is not locked.
$lockCreated = static function (array $ids, string $register) use ($pdo, $teamId): void {
    if ($ids === array() || !in_array($register, array('both', 'lab'), true)) {
        return;
    }
    $lock = $pdo->prepare('UPDATE inventory SET locked = 1, lockedby = userid, locked_at = CURRENT_TIMESTAMP WHERE id IN (' . implode(',', array_map('intval', $ids)) . ') AND team = :team AND locked = 0 AND custom_id IS NOT NULL');
    $lock->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($lock);
};
$makeEntry = static function (array $row, int $categoryId, array $definitions, string $register, ?Users $Owner = null, bool $keepNumber = false) use ($App, $pdo, $teamId, &$openKeys, $nameTokens): array {
    // 'lab' (the lab Database only) and 'both' (the lab Database and the own database of the user) give the number of the lab
    $inLab = $register === 'lab' || $register === 'both';
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
    if ($inLab) {
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
    if ($keepNumber && $inLab) {
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
    $Entry->asUnregistered = !$inLab;
    $Entry->withPersonal = $register === 'both' || $register === 'personal';
    $newId = $Entry->create(title: mb_substr($title, 0, 255), category: $categoryId, customId: $number, metadata: json_encode(array('extra_fields' => (object) $fields), JSON_UNESCAPED_UNICODE));
    // the entries of a shared account of LabCollector ("Wild Card") belong to the whole team: everyone can edit them
    $rowMail = strtolower(trim((string) ($row['owner_email'] ?? '')));
    if (in_array(strtolower(trim((string) ($row['owner'] ?? ''))), array('wild card'), true) || ($rowMail !== '' && isset($openKeys[$rowMail])) || isset($openKeys[implode(' ', $nameTokens((string) ($row['owner'] ?? '')))])) {
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
    if (!in_array($register, array('both', 'lab', 'personal', 'none'), true)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $settings = json_decode((string) $module['settings'], true);
    $needsFile = is_array($settings) && !empty($settings['requires_sequence_file']);
    // from a list of rows (not a zip) the entries of such a module go in the lab Database only when each row brings its sequence file
    $rowsHaveFiles = !$isZip && is_array($payload['rows'] ?? null) && $payload['rows'] !== array() && count(array_filter($payload['rows'], static fn($r): bool => is_array($r) && is_array($r['sequence_file'] ?? null) && trim((string) ($r['sequence_file']['content'] ?? '')) !== '')) === count($payload['rows']);
    if (in_array($register, array('both', 'lab'), true) && $needsFile && !$isZip && !$rowsHaveFiles) {
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
        if (trim((string) $user['email']) !== '') {
            $byEmail[strtolower(trim((string) $user['email']))] = (int) $user['id'];
        }
        $byName[strtolower(trim((string) $user['name']))] = (int) $user['id'];
    }
    // the people matched by an admin (a LabCollector person to a user of the team) come first
    $savedByEmail = array();
    $savedByName = array();
    if ($ownerMode === 'column') {
        foreach ($ownerMapRows() as $pair) {
            if ($pair['elab_name'] === '*') {
                foreach (array(strtolower((string) $pair['lc_email']), implode(' ', $nameTokens((string) $pair['lc_name']))) as $key) {
                    if ($key !== '') {
                        $openKeys[$key] = true;
                    }
                }
                continue;
            }
            $target = 0;
            if ($pair['elab_email'] !== '' && isset($byEmail[strtolower($pair['elab_email'])])) {
                $target = $byEmail[strtolower($pair['elab_email'])];
            } elseif ($pair['elab_name'] !== '') {
                $wanted = $nameTokens((string) $pair['elab_name']);
                foreach ($users as $user) {
                    if ($wanted !== array() && $nameTokens((string) $user['name']) === $wanted) {
                        $target = (int) $user['id'];
                    }
                }
            }
            if ($target > 0) {
                if ($pair['lc_email'] !== '') {
                    $savedByEmail[strtolower($pair['lc_email'])] = $target;
                }
                if ($pair['lc_name'] !== '') {
                    $savedByName[implode(' ', $nameTokens((string) $pair['lc_name']))] = $target;
                }
            }
        }
    }
    $ownerUsers = array();
    $notFound = array();
    $ownerFor = static function (array $row) use ($ownerMode, $ownerChoice, $defaultOwner, $byEmail, $byName, $savedByEmail, $savedByName, $nameTokens, $teamId, &$ownerUsers, &$notFound, $userId, &$openKeys): ?Users {
        $id = 0;
        if ($ownerMode === 'user') {
            $id = $ownerChoice;
        } elseif ($ownerMode === 'column') {
            $mail = strtolower(trim((string) ($row['owner_email'] ?? '')));
            $name = strtolower(trim((string) ($row['owner'] ?? '')));
            $id = $savedByEmail[$mail] ?? ($savedByName[implode(' ', $nameTokens($name))] ?? ($byEmail[$mail] ?? ($byName[$name] ?? 0)));
            // Wild Card is a shared account, not a person who is missing
            if ($id === 0 && ($mail !== '' || $name !== '') && $name !== 'wild card' && !isset($openKeys[$mail]) && !isset($openKeys[implode(' ', $nameTokens($name))])) {
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

    // the primers written in the GenBank files of the plasmids of an import (option "primers" of the form): the ones that are in the database
    // (found by their letters, either strand) are attached to the plasmid and, with the choice "create", the ones that are not are made first
    $linkFilePrimers = static function (array $files, string $mode) use ($App, $pdo, $teamId, $userId, $register, $makeEntry, $fieldsOf, $ownerFor): array {
        $report = array('plasmids' => count($files), 'attached' => 0, 'already' => 0, 'created' => 0, 'missing' => 0, 'too_short' => 0, 'ambiguous' => array(), 'not_made' => array(), 'errors' => array());
        // every primer and probe the importer can read, by the letters of the oligo
        $canFilter = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
        $req = $pdo->prepare('SELECT entity.id, entity.metadata FROM inventory AS entity
            INNER JOIN inventory_categories AS c ON c.id = entity.category
            WHERE entity.state = 1 AND entity.is_planned = 0 AND entity.team = :team AND c.title REGEXP \'^(primers?|probes?)$\'' . $canFilter);
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':userid', $userId, PDO::PARAM_INT);
        $pdo->execute($req);
        $known = array();
        foreach ($req->fetchAll() as $row) {
            $metadata = json_decode((string) ($row['metadata'] ?? ''), true);
            foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
                if (is_array($field) && preg_match('/^sequence/i', (string) $name) === 1) {
                    $letters = GenbankPrimers::clean((string) ($field['value'] ?? ''));
                    if (strlen($letters) >= GenbankPrimers::MIN_LENGTH) {
                        $known[GenbankPrimers::key($letters)][] = (int) $row['id'];
                    }
                    break;
                }
            }
        }
        $module = null;
        if ($mode === 'create') {
            $req = $pdo->prepare('SELECT id, title, fields, settings FROM inventory_categories WHERE team = :team AND state = 1 AND title REGEXP \'^primers?$\' ORDER BY id LIMIT 1');
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($req);
            $found = $req->fetch();
            $module = is_array($found) ? $found : null;
            if ($module === null) {
                $report['errors'][] = 'There is no module of primers: no primer was made.';
            }
        }
        $definitions = $module !== null ? $fieldsOf($module) : array();
        $sequenceField = null;
        $orientationField = null;
        foreach (array_keys($definitions) as $name) {
            if ($sequenceField === null && preg_match('/^sequence/i', (string) $name) === 1) {
                $sequenceField = (string) $name;
            } elseif ($orientationField === null && preg_match('/^orientation/i', (string) $name) === 1) {
                $orientationField = (string) $name;
            }
        }
        $attach = $pdo->prepare('INSERT IGNORE INTO inventory_primer_links (plasmid_id, primer_id, users_id) VALUES (:plasmid, :primer, :userid)');
        $madeNames = array();
        foreach ($files as $file) {
            try {
                foreach (GenbankPrimers::read((string) $file['content']) as $primer) {
                    if (strlen($primer['bases']) < GenbankPrimers::MIN_LENGTH) {
                        $report['too_short']++;
                        continue;
                    }
                    $key = GenbankPrimers::key($primer['bases']);
                    $ids = array_values(array_unique($known[$key] ?? array()));
                    if (count($ids) > 1) {
                        $report['ambiguous'][] = $primer['name'] . ' (' . $file['title'] . ')';
                        continue;
                    }
                    if ($ids === array()) {
                        if ($mode !== 'create' || $module === null) {
                            $report['missing']++;
                            continue;
                        }
                        // two different primers with one name (in one import) are told apart by the plasmid and the place
                        $title = $primer['name'];
                        if (isset($madeNames[strtolower($title)]) && $madeNames[strtolower($title)] !== $key) {
                            $title .= ' (' . $file['title'] . ' ' . $primer['start'] . '-' . $primer['end'] . ')';
                        }
                        $row = array('title' => $title, 'fields' => array(), 'extra' => array());
                        if ($sequenceField !== null) {
                            $row['fields'][$sequenceField] = $primer['bases'];
                        } else {
                            $row['extra']['Sequence'] = $primer['bases'];
                        }
                        if ($orientationField !== null) {
                            $row['fields'][$orientationField] = $primer['forward'] ? 'Forward' : 'Reverse';
                        }
                        $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($file['row']), false);
                        if ($made['id'] === null) {
                            $report['not_made'][] = $primer['name'] . ': ' . $made['reason'];
                            continue;
                        }
                        $madeNames[strtolower($title)] = $key;
                        $known[$key][] = (int) $made['id'];
                        $ids = array((int) $made['id']);
                        $report['created']++;
                    }
                    $attach->bindValue(':plasmid', (int) $file['plasmid'], PDO::PARAM_INT);
                    $attach->bindValue(':primer', $ids[0], PDO::PARAM_INT);
                    $attach->bindValue(':userid', $userId, PDO::PARAM_INT);
                    $pdo->execute($attach);
                    $report[$attach->rowCount() > 0 ? 'attached' : 'already']++;
                }
            } catch (Throwable $e) {
                $report['errors'][] = $file['title'] . ': ' . $e->getMessage();
            }
        }
        $report['ambiguous'] = array_slice(array_values(array_unique($report['ambiguous'])), 0, 20);
        $report['not_made'] = array_slice($report['not_made'], 0, 20);
        $report['errors'] = array_slice($report['errors'], 0, 20);
        return $report;
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
        $primerMode = in_array((string) ($source['primers'] ?? ''), array('attach', 'create'), true) ? (string) $source['primers'] : '';
        $genbankFiles = array();
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
                        $fillBackbone((int) $made['id'], $fileName, $content, (string) $row['title']);
                        if ($primerMode !== '' && preg_match('/\.(gb|gbk|gbff|genbank)$/i', $fileName) === 1) {
                            $genbankFiles[] = array('plasmid' => (int) $made['id'], 'title' => (string) $row['title'], 'content' => $content, 'row' => $row);
                        }
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
        $primerReport = $primerMode !== '' ? $linkFilePrimers($genbankFiles, $primerMode) : null;
        $lockCreated($created, $register);
    respond(200, array('created' => count($created), 'files' => $filesAttached, 'skipped' => $skipped, 'owners_not_found' => array_keys($notFound), 'primers' => $primerReport, 'backbones' => $backbones));
    }

    foreach (array_slice(is_array($payload['rows'] ?? null) ? $payload['rows'] : array(), 0, 200) as $index => $row) {
        $made = $makeEntry($row, (int) $module['id'], $definitions, $register, $ownerFor($row), $keepNumbers);
        if ($made['id'] === null) {
            $skipped[] = array('row' => 'Row ' . ((int) ($payload['offset'] ?? 0) + $index + 1) . ' (' . trim((string) ($row['title'] ?? '')) . ')', 'reason' => $made['reason']);
            continue;
        }
        $created[] = $made['id'];
        // the place chosen in the dialog "Add from an order": one container of the entry is stored there (the first of its storage)
        $wantedStorage = (int) ($payload['storage_id'] ?? 0);
        if ($wantedStorage > 0) {
            try {
                $exists = $pdo->prepare('SELECT COUNT(*) FROM storage_units WHERE id = :id');
                $exists->bindValue(':id', $wantedStorage, PDO::PARAM_INT);
                $pdo->execute($exists);
                if ((int) $exists->fetchColumn() === 0) {
                    throw new RuntimeException('This place does not exist.');
                }
                $store = $pdo->prepare('INSERT INTO containers2inventory (storage_id, item_id, qty_stored, qty_unit, is_primary) VALUES (:storage, :item, 1, :unit, 1)');
                $store->bindValue(':storage', $wantedStorage, PDO::PARAM_INT);
                $store->bindValue(':item', (int) $made['id'], PDO::PARAM_INT);
                $store->bindValue(':unit', '•');
                $pdo->execute($store);
            } catch (Throwable $e) {
                $skipped[] = array('row' => 'Storage of row ' . ((int) ($payload['offset'] ?? 0) + $index + 1), 'reason' => $e->getMessage());
            }
        }
        // the folder chosen for the entries of My entries (the Database keeps its own folders)
        $wantedFolder = (int) ($payload['folder_id'] ?? 0);
        if ($wantedFolder > 0 && !in_array($register, array('both', 'lab'), true)) {
            try {
                (new Inventory($App->Users, (int) $made['id']))->patch(Action::Update, array('folder_id' => (string) $wantedFolder));
            } catch (Throwable $e) {
                $skipped[] = array('row' => 'Folder of row ' . ((int) ($payload['offset'] ?? 0) + $index + 1), 'reason' => $e->getMessage());
            }
        }
        // a sequence file that came with the row (read from a file, pasted, or downloaded from Addgene by the user) is attached to the entry
        $file = is_array($row['sequence_file'] ?? null) ? $row['sequence_file'] : null;
        if ($file !== null) {
            $content = base64_decode((string) ($file['content'] ?? ''), true);
            $fileName = preg_replace('/[^A-Za-z0-9_.-]+/', '_', (string) ($file['name'] ?? 'sequence.fasta')) ?: 'sequence.fasta';
            if ($content !== false && $content !== '' && strlen($content) < 5000000 && preg_match('/\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i', $fileName) === 1) {
                try {
                    $jsonFs ??= Storage::EXPORTS->getStorage()->getFs();
                    $jsonTmp ??= 'registry-import-' . bin2hex(random_bytes(6));
                    $path = $jsonTmp . '/' . bin2hex(random_bytes(4)) . '-' . $fileName;
                    $jsonFs->write($path, $content);
                    new Inventory($App->Users, (int) $made['id'])->Uploads->create(new CreateUploadFromFs($jsonFs, $fileName, $path, new FileHash($jsonFs, $path)));
                    $fillBackbone((int) $made['id'], $fileName, $content, (string) $row['title']);
                } catch (Throwable $e) {
                    $skipped[] = array('row' => 'File of row ' . ((int) ($payload['offset'] ?? 0) + $index + 1), 'reason' => $e->getMessage());
                }
            }
        }
    }
    if (isset($jsonFs, $jsonTmp)) {
        try {
            $jsonFs->deleteDirectory($jsonTmp);
        } catch (Throwable) {
            // cleaned later with the exports
        }
    }
    $lockCreated($created, $register);
    respond(200, array('created' => count($created), 'skipped' => $skipped, 'owners_not_found' => array_keys($notFound), 'backbones' => $backbones));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
