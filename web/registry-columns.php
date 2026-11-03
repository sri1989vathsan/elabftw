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

use function array_slice;
use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function is_string;
use function json_decode;
use function json_encode;
use function mb_substr;
use function preg_match;

/**
 * The columns a user hides or adds in the tables of the database, for each module: they follow the account.
 *
 * GET gives {prefs: {<module key>: {hidden: [keys], extra: [field names]}}} of the user.
 * POST {module_key, hidden, extra} saves the choice for one module (a module key is the id of the module, or "mixed").
 */
require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

$pdo = Db::getConnection();
$userId = (int) $App->Users->userData['userid'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $req = $pdo->prepare('SELECT module_key, hidden, extra FROM registry_column_prefs WHERE users_id = :user');
    $req->bindValue(':user', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $prefs = array();
    foreach ($req->fetchAll() as $row) {
        $prefs[(string) $row['module_key']] = array(
            'hidden' => json_decode((string) $row['hidden'], true) ?: array(),
            'extra' => json_decode((string) $row['extra'], true) ?: array(),
        );
    }
    respond(200, array('prefs' => (object) $prefs));
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
$moduleKey = is_array($payload) ? (string) ($payload['module_key'] ?? '') : '';
if (preg_match('/^(\d{1,10}|mixed)$/', $moduleKey) !== 1) {
    respond(400, array('error' => 'Invalid request.'));
}
$clean = static function (mixed $list): array {
    $out = array();
    foreach (is_array($list) ? array_slice($list, 0, 100) : array() as $item) {
        if (is_string($item) && $item !== '') {
            $out[] = mb_substr($item, 0, 100);
        }
    }
    return $out;
};
try {
    $req = $pdo->prepare('INSERT INTO registry_column_prefs (users_id, module_key, hidden, extra) VALUES (:user, :module, :hidden, :extra) ON DUPLICATE KEY UPDATE hidden = VALUES(hidden), extra = VALUES(extra)');
    $req->bindValue(':user', $userId, PDO::PARAM_INT);
    $req->bindValue(':module', $moduleKey);
    $req->bindValue(':hidden', json_encode($clean($payload['hidden'] ?? array())));
    $req->bindValue(':extra', json_encode($clean($payload['extra'] ?? array())));
    $pdo->execute($req);
    respond(200, array('ok' => true));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
