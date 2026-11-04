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

use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_strlen;
use function trim;

/**
 * The kinds of storage places: the five that exist from the start and the ones an admin adds. A kind made by an admin behaves like one of the
 * others (a location, a cooler: a fridge or a freezer, a rack, a box).
 *
 * GET gives the kinds (everyone). POST {action: add, name, behaves_like, default_temperature} and {action: delete, name} are for admins.
 */
require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if ($App->isAnonymous()) {
    respond(403, array('error' => 'Sign in first.'));
}
$pdo = Db::getConnection();
const BUILT_IN = array(
    array('name' => 'location', 'behaves_like' => 'location', 'default_temperature' => null, 'built_in' => true),
    array('name' => 'freezer', 'behaves_like' => 'cooler', 'default_temperature' => -20, 'built_in' => true),
    array('name' => 'fridge', 'behaves_like' => 'cooler', 'default_temperature' => 4, 'built_in' => true),
    array('name' => 'rack', 'behaves_like' => 'rack', 'default_temperature' => null, 'built_in' => true),
    array('name' => 'box', 'behaves_like' => 'box', 'default_temperature' => null, 'built_in' => true),
);
const BEHAVIOURS = array('location', 'cooler', 'rack', 'box');

$isAdmin = (bool) $App->Users->isAdmin;
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $req = $pdo->prepare('SELECT name, behaves_like, default_temperature FROM storage_kinds ORDER BY name');
    $pdo->execute($req);
    $custom = array();
    foreach ($req->fetchAll() as $row) {
        $custom[] = array('name' => (string) $row['name'], 'behaves_like' => (string) $row['behaves_like'], 'default_temperature' => $row['default_temperature'] === null ? null : (int) $row['default_temperature'], 'built_in' => false);
    }
    respond(200, array('kinds' => array_merge(BUILT_IN, $custom), 'is_admin' => $isAdmin));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
if (!$isAdmin) {
    respond(403, array('error' => 'Only an admin can add or remove kinds of places.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
try {
    $name = trim((string) ($payload['name'] ?? ''));
    if (($payload['action'] ?? '') === 'add') {
        $behaves = (string) ($payload['behaves_like'] ?? '');
        if ($name === '' || mb_strlen($name) > 40 || !in_array($behaves, BEHAVIOURS, true)) {
            respond(400, array('error' => 'Give a name (up to 40 characters) and what it behaves like.'));
        }
        foreach (BUILT_IN as $builtIn) {
            if (strtolower($builtIn['name']) === strtolower($name)) {
                respond(409, array('error' => 'This kind exists already.'));
            }
        }
        $degrees = filter_var($payload['default_temperature'] ?? null, FILTER_VALIDATE_INT, array('options' => array('min_range' => -273, 'max_range' => 100)));
        $req = $pdo->prepare('INSERT INTO storage_kinds (name, behaves_like, default_temperature) VALUES (:name, :behaves, :temperature)');
        $req->bindValue(':name', $name);
        $req->bindValue(':behaves', $behaves);
        $req->bindValue(':temperature', $degrees === false || $behaves !== 'cooler' ? null : $degrees, $degrees === false || $behaves !== 'cooler' ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('ok' => true));
    }
    if (($payload['action'] ?? '') === 'delete') {
        $use = $pdo->prepare('SELECT COUNT(*) FROM storage_units WHERE kind = :name');
        $use->bindValue(':name', $name);
        $pdo->execute($use);
        if ((int) $use->fetchColumn() > 0) {
            respond(409, array('error' => 'Places of this kind exist: change their kind first.'));
        }
        $req = $pdo->prepare('DELETE FROM storage_kinds WHERE name = :name');
        $req->bindValue(':name', $name);
        $pdo->execute($req);
        respond(200, array('ok' => true));
    }
    respond(400, array('error' => 'Invalid request.'));
} catch (Throwable $e) {
    respond(500, array('error' => $e->getCode() === '23000' ? 'This kind exists already.' : 'Could not do it.'));
}
