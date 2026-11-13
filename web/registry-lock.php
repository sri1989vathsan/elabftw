<?php

/**
 * Fork-only. Locks an entry of the lab Database. The lock button of the page toggles (a second call would unlock); this call only locks:
 * POST {id} locks the entry when it is in the lab Database or in My database (it has a number of the lab or of its owner) and is not locked yet, and gives {locked: true}. It is called
 * when an entry enters the Database (after its file, its details and its primers are done), and when an edit is over (the person leaves
 * the edit page, the sequence editor has saved): an entry that was unlocked by hand to edit it goes back to locked. An entry that is only in
 * My entries (no number) is not locked. Needs the right to edit the entry; unlocking is done by hand with the lock button.
 *
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\AccessType;
use Elabftw\Models\Changelog;
use Elabftw\Models\Inventory;
use Elabftw\Params\ContentParams;
use Throwable;

use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function json_decode;
use function json_encode;

require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || $App->isAnonymous()) {
    respond(401, array('error' => 'Authentication required.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
$id = is_array($payload) ? (int) ($payload['id'] ?? 0) : 0;
if ($id <= 0) {
    respond(400, array('error' => 'Invalid request.'));
}
try {
    $Entry = new Inventory($App->Users, $id);
    $Entry->readOne();
    $Entry->canOrExplode(AccessType::Write);
    // only an entry of the Database (with a number) is locked, and only when it is not locked yet
    if (($Entry->entityData['custom_id'] ?? null) === null && ($Entry->entityData['personal_id'] ?? null) === null) {
        respond(200, array('locked' => false, 'reason' => 'This entry is not in the Database.'));
    }
    if ((int) ($Entry->entityData['locked'] ?? 0) === 1) {
        respond(200, array('locked' => true));
    }
    $pdo = Db::getConnection();
    $req = $pdo->prepare('UPDATE inventory SET locked = 1, lockedby = :user, locked_at = CURRENT_TIMESTAMP WHERE id = :id AND locked = 0');
    $req->bindValue(':user', (int) $App->Users->userData['userid'], \PDO::PARAM_INT);
    $req->bindValue(':id', $id, \PDO::PARAM_INT);
    $pdo->execute($req);
    if ($req->rowCount() > 0) {
        new Changelog($Entry)->create(new ContentParams('locked', 'Locked'));
    }
    respond(200, array('locked' => true));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
