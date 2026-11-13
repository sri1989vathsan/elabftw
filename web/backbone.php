<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Models\Inventory;
use PDO;
use Throwable;

/**
 * The Backbone of a plasmid from its sequence file (see backbone.inc.php). Anyone who can edit the entry.
 *
 * POST {entry: id}   fills the empty Backbone field of the plasmid from its first sequence file; answers {filled, backbone, score, reason}
 */
require_once __DIR__ . '/app/init.inc.php';
require_once __DIR__ . '/ai-features.inc.php';
require_once __DIR__ . '/backbone.inc.php';

function backboneReply(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    backboneReply(405, array('error' => 'POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    backboneReply(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
$entryId = is_array($payload) ? (int) ($payload['entry'] ?? 0) : 0;
if ($entryId < 1) {
    backboneReply(400, array('error' => 'Invalid request.'));
}
$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$App->Session->save();
set_time_limit(120);

try {
    $req = $pdo->prepare("SELECT MIN(u.long_name) AS file FROM uploads AS u
        WHERE u.item_id = :id AND u.type = 'inventory' AND u.state = 1 AND (u.real_name LIKE '%.gb' OR u.real_name LIKE '%.gbk' OR u.real_name LIKE '%.ape' OR u.real_name LIKE '%.fasta' OR u.real_name LIKE '%.fa')");
    $req->bindValue(':id', $entryId, PDO::PARAM_INT);
    $req->execute();
    $name = (string) $req->fetchColumn();
    $dir = rtrim((string) (getenv('ELAB_UPLOADS_DIR') ?: '/var/lib/elabftw/uploads'), '/');
    $path = $dir . '/' . $name;
    if ($name === '' || str_contains($name, '..') || !is_file($path) || filesize($path) > 8000000) {
        backboneReply(200, array('filled' => false, 'backbone' => '', 'score' => 0, 'reason' => 'The entry has no sequence file to read.'));
    }
    $Entry = new Inventory($App->Users, $entryId);
    backboneReply(200, (new Backbone($pdo, $teamId))->fill($Entry, $entryId, (string) file_get_contents($path)));
} catch (Throwable $e) {
    backboneReply(400, array('error' => $e->getMessage()));
}
