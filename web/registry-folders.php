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
use PDO;
use Throwable;

use function array_map;
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
use function trim;

/**
 * The folders of the database: a tree of its own, apart from the folders of the experiments and of the resources. An entry is in
 * one folder at most.
 *
 * GET gives the folders of the team (id, name, parent, owner, number of entries) and, for each entry that is in a folder, the folder.
 * POST {action: create, name, parent?}                 makes a folder (anyone of the team)
 * POST {action: rename, id, name}                      renames a folder (its creator or an admin)
 * POST {action: move, id, parent|null}                 moves a folder in another one or to the top (its creator or an admin)
 * POST {action: delete, id}                            removes a folder and the folders in it; the entries become unfiled
 * POST {action: assign, entry, folder|null}            puts an entry in a folder, or takes it out; the entry must be editable
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
$teamId = (int) $App->Users->userData['team'];
$userId = (int) $App->Users->userData['userid'];
$isAdmin = (bool) $App->Users->isAdmin;

/**
 * A folder of the team, null when there is none with this id
 *
 * @return array{id: int, parent_id: int|null, userid: int, name: string}|null
 */
function folderOf(Db $pdo, int $teamId, int $id): ?array
{
    $req = $pdo->prepare('SELECT id, parent_id, userid, name FROM registry_folders WHERE id = :id AND team = :team');
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $folder = $req->fetch();
    return is_array($folder) ? array('id' => (int) $folder['id'], 'parent_id' => $folder['parent_id'] === null ? null : (int) $folder['parent_id'], 'userid' => (int) $folder['userid'], 'name' => (string) $folder['name']) : null;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        respond(403, array('error' => 'Invalid token.'));
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $action = (string) ($payload['action'] ?? '');
    $name = mb_substr(trim((string) ($payload['name'] ?? '')), 0, 255);
    $mayChange = static fn(array $folder): bool => $isAdmin || $folder['userid'] === $userId;

    if ($action === 'create') {
        $parent = isset($payload['parent']) && $payload['parent'] !== null ? (int) $payload['parent'] : null;
        if ($name === '') {
            respond(400, array('error' => 'A folder needs a name.'));
        }
        if ($parent !== null && folderOf($pdo, $teamId, $parent) === null) {
            respond(404, array('error' => 'The folder does not exist.'));
        }
        $req = $pdo->prepare('INSERT INTO registry_folders (team, name, parent_id, userid) VALUES (:team, :name, :parent, :userid)');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':name', $name);
        $req->bindValue(':parent', $parent, $parent === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':userid', $userId, PDO::PARAM_INT);
        $pdo->execute($req);
        respond(201, array('ok' => true, 'id' => (int) $pdo->lastInsertId()));
    }

    if (in_array($action, array('rename', 'move', 'delete'), true)) {
        $folder = folderOf($pdo, $teamId, (int) ($payload['id'] ?? 0));
        if ($folder === null) {
            respond(404, array('error' => 'The folder does not exist.'));
        }
        if (!$mayChange($folder)) {
            respond(403, array('error' => 'Only the creator of a folder or an admin can change it.'));
        }
        if ($action === 'rename') {
            if ($name === '') {
                respond(400, array('error' => 'A folder needs a name.'));
            }
            $req = $pdo->prepare('UPDATE registry_folders SET name = :name WHERE id = :id');
            $req->bindValue(':name', $name);
        } elseif ($action === 'delete') {
            $req = $pdo->prepare('DELETE FROM registry_folders WHERE id = :id');
        } else {
            $parent = isset($payload['parent']) && $payload['parent'] !== null ? (int) $payload['parent'] : null;
            if ($parent !== null) {
                // a folder cannot go into itself or into a folder inside of it
                for ($up = folderOf($pdo, $teamId, $parent), $guard = 0; $up !== null && $guard < 200; $guard++) {
                    if ($up['id'] === $folder['id']) {
                        respond(400, array('error' => 'A folder cannot go into itself.'));
                    }
                    $up = $up['parent_id'] === null ? null : folderOf($pdo, $teamId, $up['parent_id']);
                }
                if (folderOf($pdo, $teamId, $parent) === null) {
                    respond(404, array('error' => 'The folder does not exist.'));
                }
            }
            $req = $pdo->prepare('UPDATE registry_folders SET parent_id = :parent WHERE id = :id');
            $req->bindValue(':parent', $parent, $parent === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        }
        $req->bindValue(':id', $folder['id'], PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('ok' => true));
    }

    if ($action === 'assign') {
        $entry = (int) ($payload['entry'] ?? 0);
        $target = isset($payload['folder']) && $payload['folder'] !== null ? (int) $payload['folder'] : null;
        try {
            $Entry = new Inventory($App->Users, $entry);
            $Entry->readOne();
            $Entry->canOrExplode(AccessType::Write);
        } catch (Throwable) {
            respond(403, array('error' => 'You cannot edit this entry.'));
        }
        if ($target === null) {
            $req = $pdo->prepare('DELETE FROM registry_folder_entries WHERE entry_id = :entry');
        } else {
            if (folderOf($pdo, $teamId, $target) === null) {
                respond(404, array('error' => 'The folder does not exist.'));
            }
            $req = $pdo->prepare('INSERT INTO registry_folder_entries (entry_id, folder_id) VALUES (:entry, :folder) ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id)');
            $req->bindValue(':folder', $target, PDO::PARAM_INT);
        }
        $req->bindValue(':entry', $entry, PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('ok' => true));
    }
    respond(400, array('error' => 'Invalid request.'));
}

// the folders of the team with the number of entries in each, and the folder of each entry that is in one
$req = $pdo->prepare('SELECT f.id, f.name, f.parent_id, f.userid, f.ordering, CONCAT(u.firstname, " ", u.lastname) AS owner, (SELECT COUNT(*) FROM registry_folder_entries AS e INNER JOIN inventory AS i ON i.id = e.entry_id WHERE e.folder_id = f.id AND i.state = 1) AS entries FROM registry_folders AS f LEFT JOIN users AS u ON u.userid = f.userid WHERE f.team = :team ORDER BY f.name');
$req->bindValue(':team', $teamId, PDO::PARAM_INT);
$pdo->execute($req);
$folders = array_map(static fn(array $f): array => array(
    'id' => (int) $f['id'],
    'name' => (string) $f['name'],
    'parent_id' => $f['parent_id'] === null ? null : (int) $f['parent_id'],
    'userid' => (int) $f['userid'],
    'owner' => (string) $f['owner'],
    'entries' => (int) $f['entries'],
    'mine' => (int) $f['userid'] === $userId || $isAdmin,
), $req->fetchAll());

$req = $pdo->prepare('SELECT e.entry_id, e.folder_id FROM registry_folder_entries AS e INNER JOIN registry_folders AS f ON f.id = e.folder_id AND f.team = :team INNER JOIN inventory AS i ON i.id = e.entry_id AND i.state = 1');
$req->bindValue(':team', $teamId, PDO::PARAM_INT);
$pdo->execute($req);
$assignments = array();
foreach ($req->fetchAll() as $row) {
    $assignments[(int) $row['entry_id']] = (int) $row['folder_id'];
}
respond(200, array('folders' => $folders, 'assignments' => (object) $assignments, 'userid' => $userId));
