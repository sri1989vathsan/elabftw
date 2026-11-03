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
use Elabftw\Services\CanSqlBuilder;
use PDO;
use Throwable;

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

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
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
    $req = $pdo->prepare('SELECT entity.id, entity.title, entity.custom_id, entity.personal_id, entity.date, entity.metadata, CONCAT(u.firstname, " ", u.lastname) AS owner
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
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $slug . '-' . ($scope === 'mine' ? 'mine' : 'lab') . '-' . gmdate('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'wb');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, array_merge(array('ID', 'My ID', 'Title', 'Date', 'Owner'), array_keys($names)), ',', '"', '');
    foreach ($entries as $index => $entry) {
        $row = array((string) ($entry['custom_id'] ?? ''), (string) ($entry['personal_id'] ?? ''), (string) $entry['title'], (string) $entry['date'], (string) $entry['owner']);
        foreach (array_keys($names) as $name) {
            $value = $decodedEntries[$index][$name]['value'] ?? '';
            $row[] = is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value;
        }
        fputcsv($out, $row, ',', '"', '');
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
try {
    $module = $loadModule((int) ($payload['category'] ?? 0));
    if ($module === null) {
        respond(404, array('error' => 'This module is not in your team.'));
    }
    $register = (string) ($payload['register'] ?? 'personal');
    if (!in_array($register, array('both', 'personal', 'none'), true)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $settings = json_decode((string) $module['settings'], true);
    if ($register === 'both' && is_array($settings) && !empty($settings['requires_sequence_file'])) {
        respond(400, array('error' => 'The entries of this module need a sequence file to go in the lab Database: import them into your own database, attach the files, and register them.'));
    }
    $definitions = $fieldsOf($module);
    $created = array();
    $skipped = array();
    foreach (array_slice(is_array($payload['rows'] ?? null) ? $payload['rows'] : array(), 0, 200) as $index => $row) {
        $label = 'Row ' . ($index + 1);
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            $skipped[] = array('row' => $label, 'reason' => 'It has no title.');
            continue;
        }
        // the fields of the module, with the values of the row
        $fields = $definitions;
        $values = is_array($row['fields'] ?? null) ? $row['fields'] : array();
        foreach ($values as $name => $value) {
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
                $skipped[] = array('row' => $label . ' (' . $title . ')', 'reason' => 'It needs: ' . implode(', ', $missing) . '.');
                continue;
            }
        }
        $Entry = new Inventory($App->Users);
        $Entry->asUnregistered = $register !== 'both';
        $Entry->withPersonal = $register === 'both' || $register === 'personal';
        $id = $Entry->create(title: mb_substr($title, 0, 255), category: (int) $module['id'], metadata: json_encode(array('extra_fields' => (object) $fields), JSON_UNESCAPED_UNICODE));
        $created[] = $id;
    }
    respond(200, array('created' => count($created), 'skipped' => $skipped));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
