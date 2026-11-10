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

use PDO;
use Throwable;

use function array_map;
use function array_slice;
use function count;
use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_strlen;
use function mb_substr;
use function preg_match;
use function trim;
use function uasort;

/**
 * The rules of the modules of the database: their fields (the custom fields a new entry starts with) and their settings (the columns of
 * their list, the field that holds the sequence, whether a sequence file is needed to register).
 *
 * GET gives the modules of the team with their fields and settings (everyone: the lists need the columns).
 * POST {action: save, id, fields: [{name, type, options, required, value, unit}], settings: {columns: [{key, label}], sequence_field, allows_reads,
 * requires_sequence_file, track_low_stock, default_min_stock, default_min_unit}, apply_existing} is for admins; apply_existing adds the new fields to the entries that exist.
 */
require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

const FIELD_TYPES = array('text', 'number', 'select', 'radio', 'checkbox', 'date', 'url', 'email', 'time');
const BUILT_IN_COLUMNS = array('files', 'quantity', 'owner', 'calc:length', 'calc:gc');

$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$userId = (int) $App->Users->userData['userid'];
require_once __DIR__ . '/registry-defaults.inc.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && !$App->isAnonymous()) {
    seedDefaultModules($teamId);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $req = $pdo->prepare('SELECT id, title, color, fields, settings, owner FROM inventory_categories WHERE team = :team AND state = 1 AND (owner IS NULL OR owner = :me) ORDER BY ordering, title');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':me', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $modules = array();
    foreach ($req->fetchAll() as $row) {
        $decoded = json_decode((string) $row['fields'], true);
        $fields = array();
        foreach (is_array($decoded) && is_array($decoded['extra_fields'] ?? null) ? $decoded['extra_fields'] : array() as $name => $field) {
            if (is_array($field)) {
                $fields[] = array(
                    'name' => (string) $name,
                    'type' => (string) ($field['type'] ?? 'text'),
                    'options' => is_array($field['options'] ?? null) ? $field['options'] : array(),
                    'required' => !empty($field['required']),
                    'value' => is_array($field['value'] ?? null) ? '' : (string) ($field['value'] ?? ''),
                    'unit' => (string) ($field['unit'] ?? ''),
                    'position' => (int) ($field['position'] ?? 0),
                );
            }
        }
        uasort($fields, static fn(array $a, array $b): int => $a['position'] <=> $b['position']);
        $settings = json_decode((string) $row['settings'], true);
        $modules[] = array(
            'id' => (int) $row['id'],
            'title' => (string) $row['title'],
            'color' => (string) $row['color'],
            'is_personal' => $row['owner'] !== null,
            'fields' => array_map(static fn(array $f): array => $f, array_slice(array_values($fields), 0, 60)),
            'settings' => is_array($settings) ? $settings : array('columns' => array(), 'sequence_field' => null, 'requires_sequence_file' => false),
        );
    }
    respond(200, array('modules' => $modules, 'is_admin' => (bool) $App->Users->isAdmin));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload) || ($payload['action'] ?? '') !== 'save') {
    respond(400, array('error' => 'Invalid request.'));
}
// the rules of a module of the lab are for the admins; the owner of a personal module sets the rules of their own
if (!$App->Users->isAdmin) {
    $mine = $pdo->prepare('SELECT COUNT(*) FROM inventory_categories WHERE id = :id AND owner = :me');
    $mine->bindValue(':id', (int) ($payload['id'] ?? 0), PDO::PARAM_INT);
    $mine->bindValue(':me', $userId, PDO::PARAM_INT);
    $pdo->execute($mine);
    if ((int) $mine->fetchColumn() === 0) {
        respond(403, array('error' => 'Only an admin can change the rules of a module of the lab.'));
    }
}

try {
    $id = (int) ($payload['id'] ?? 0);
    $check = $pdo->prepare('SELECT id FROM inventory_categories WHERE id = :id AND team = :team AND (owner IS NULL OR owner = ' . $userId . ')');
    $check->bindValue(':id', $id, PDO::PARAM_INT);
    $check->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($check);
    if ($check->fetchColumn() === false) {
        respond(404, array('error' => 'This module is not in your team.'));
    }

    // the fields
    $extra = array();
    $names = array();
    foreach (array_slice(is_array($payload['fields'] ?? null) ? $payload['fields'] : array(), 0, 60) as $index => $field) {
        $name = trim((string) ($field['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 100 || preg_match('/["\\\\]/', $name) === 1) {
            respond(400, array('error' => 'Every field needs a name of up to 100 characters, without quotes or backslashes.'));
        }
        if (isset($names[mb_substr($name, 0, 100)])) {
            respond(400, array('error' => 'Two fields are called "' . $name . '".'));
        }
        $names[$name] = true;
        $type = (string) ($field['type'] ?? 'text');
        if (!in_array($type, FIELD_TYPES, true)) {
            respond(400, array('error' => 'Unknown type of field: ' . $type . '.'));
        }
        $definition = array('type' => $type, 'value' => mb_substr((string) ($field['value'] ?? ''), 0, 255), 'position' => $index + 1);
        if ($type === 'select' || $type === 'radio') {
            $options = array();
            foreach (is_array($field['options'] ?? null) ? $field['options'] : array() as $option) {
                $option = trim(mb_substr((string) $option, 0, 100));
                if ($option !== '') {
                    $options[] = $option;
                }
            }
            if ($options === array()) {
                respond(400, array('error' => 'The field "' . $name . '" needs its choices.'));
            }
            $definition['options'] = array_slice($options, 0, 50);
        }
        if (!empty($field['required'])) {
            $definition['required'] = true;
        }
        $unit = trim(mb_substr((string) ($field['unit'] ?? ''), 0, 30));
        if ($unit !== '' && $type === 'number') {
            $definition['unit'] = $unit;
        }
        $extra[$name] = $definition;
    }

    // the settings
    $incoming = is_array($payload['settings'] ?? null) ? $payload['settings'] : array();
    $columns = array();
    foreach (array_slice(is_array($incoming['columns'] ?? null) ? $incoming['columns'] : array(), 0, 20) as $column) {
        $key = (string) ($column['key'] ?? '');
        $isField = mb_substr($key, 0, 6) === 'field:' && isset($names[mb_substr($key, 6)]);
        if (!$isField && !in_array($key, BUILT_IN_COLUMNS, true)) {
            continue;
        }
        $columns[] = array('key' => $key, 'label' => trim(mb_substr((string) ($column['label'] ?? ''), 0, 60)) ?: ($isField ? mb_substr($key, 6) : $key));
    }
    $sequenceField = (string) ($incoming['sequence_field'] ?? '');
    $settings = array(
        'columns' => $columns,
        'sequence_field' => isset($names[$sequenceField]) ? $sequenceField : null,
        'requires_sequence_file' => !empty($incoming['requires_sequence_file']),
        'track_low_stock' => ($incoming['track_low_stock'] ?? true) !== false,
        'default_min_stock' => isset($incoming['default_min_stock']) && is_numeric($incoming['default_min_stock']) && (float) $incoming['default_min_stock'] >= 0 && trim((string) ($incoming['default_min_unit'] ?? '')) !== '' ? (float) $incoming['default_min_stock'] : null,
        'default_min_unit' => isset($incoming['default_min_stock']) && is_numeric($incoming['default_min_stock']) && trim((string) ($incoming['default_min_unit'] ?? '')) !== '' ? mb_substr(trim((string) $incoming['default_min_unit']), 0, 20) : null,
    );
    // sequencing reads (.ab1 files) can be attached to the entries of this module: shows the "Attach reads" button (left out by a client that does not send it)
    if (array_key_exists('allows_reads', $incoming)) {
        $settings['allows_reads'] = !empty($incoming['allows_reads']);
    }

    $req = $pdo->prepare('UPDATE inventory_categories SET fields = :fields, settings = :settings WHERE id = :id AND team = :team');
    $req->bindValue(':fields', json_encode(array('extra_fields' => (object) $extra)));
    $req->bindValue(':settings', json_encode($settings));
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);

    // the new fields are added to the entries of the module that exist
    $updated = 0;
    if (!empty($payload['apply_existing'])) {
        $entries = $pdo->prepare('SELECT id, metadata FROM inventory WHERE category = :id');
        $entries->bindValue(':id', $id, PDO::PARAM_INT);
        $pdo->execute($entries);
        $write = $pdo->prepare('UPDATE inventory SET metadata = :metadata WHERE id = :id');
        foreach ($entries->fetchAll() as $entry) {
            $metadata = json_decode((string) $entry['metadata'], true);
            $metadata = is_array($metadata) ? $metadata : array();
            $current = is_array($metadata['extra_fields'] ?? null) ? $metadata['extra_fields'] : array();
            $added = false;
            foreach ($extra as $name => $definition) {
                if (!isset($current[$name])) {
                    $current[$name] = $definition;
                    $added = true;
                }
            }
            if ($added) {
                $metadata['extra_fields'] = $current;
                $write->bindValue(':metadata', json_encode($metadata));
                $write->bindValue(':id', (int) $entry['id'], PDO::PARAM_INT);
                $pdo->execute($write);
                $updated++;
            }
        }
    }
    respond(200, array('ok' => true, 'entries_updated' => $updated));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
