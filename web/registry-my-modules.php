<?php

/**
 * Personal modules of the Database. Fork-only file.
 *
 * A personal module looks like a module of the lab (fields, columns) but only its owner sees and uses it. Its entries stay private to the
 * owner, never get a number of the lab (only the owner's own, by the individual register) and are filed in the folder "Module Folders" of the owner.
 *
 * GET gives the personal modules of the user. POST (anyone with an account, CSRF token needed):
 * {action: create, title, color?, copy_from?}  makes one; copy_from is the id of a module (of the lab or of the user) whose fields and settings are copied
 * {action: update, id, title?, color?}         renames or recolours one of the user's modules
 * {action: delete, id, confirm_title}        removes one of the user's modules that has no entries
 * An admin can also rename, recolour and remove the personal modules of the people of the team.
 */
declare(strict_types=1);

namespace Elabftw\Elabftw;

use PDO;
use Throwable;

use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_strlen;
use function mb_substr;
use function preg_match;
use function str_contains;
use function trim;

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
$userId = (int) $App->Users->userData['userid'];
$teamId = (int) $App->Users->userData['team'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $req = $pdo->prepare('SELECT c.id, c.title, c.color, (SELECT COUNT(*) FROM inventory AS i WHERE i.category = c.id AND i.state = 1) AS entries
        FROM inventory_categories AS c WHERE c.owner = :me AND c.state = 1 ORDER BY c.ordering, c.title');
    $req->bindValue(':me', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $modules = $req->fetchAll(PDO::FETCH_ASSOC);
    // who looked at the modules of the user lately
    $seen = $pdo->prepare('SELECT CONCAT(u.firstname, " ", u.lastname) AS name, MAX(v.viewed_at) AS at FROM personal_module_views AS v JOIN users AS u ON u.userid = v.viewer
        WHERE v.owner = :me GROUP BY v.viewer, u.firstname, u.lastname ORDER BY at DESC LIMIT 10');
    $seen->bindValue(':me', $userId, PDO::PARAM_INT);
    $pdo->execute($seen);
    respond(200, array('modules' => $modules, 'views' => $seen->fetchAll(PDO::FETCH_ASSOC)));
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

/** a title that is free: not used by a module of the lab or by another module of the user (the folders are named after the modules) */
$titleIsFree = static function (string $title, int $exceptId, int $ownerId) use ($pdo, $teamId): bool {
    $req = $pdo->prepare('SELECT COUNT(*) FROM inventory_categories WHERE team = :team AND state = 1 AND id <> :id AND LOWER(title) = LOWER(:title) AND (owner IS NULL OR owner = :me)');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':id', $exceptId, PDO::PARAM_INT);
    $req->bindValue(':title', $title);
    $req->bindValue(':me', $ownerId, PDO::PARAM_INT);
    $pdo->execute($req);
    return (int) $req->fetchColumn() === 0;
};
$cleanTitle = static function (mixed $value): string {
    $title = trim(mb_substr((string) $value, 0, 100));
    if ($title === '' || str_contains($title, ' > ') || preg_match('/[<>"\\\\]/', $title) === 1) {
        respond(400, array('error' => 'A module needs a name of up to 100 characters, without quotes, angle brackets or " > ".'));
    }
    return $title;
};
$cleanColor = static function (mixed $value): string {
    $color = trim((string) $value, "# \t");
    return preg_match('/^[0-9a-fA-F]{6}$/', $color) === 1 ? $color : '5b8def';
};
// a module of the user (not a module of the lab): the only ones they can change; an admin can also change the personal modules of the people of the team.
// Gives the id of the owner of the module.
$ownOrExplode = static function (int $id) use ($pdo, $userId, $teamId, $App): int {
    $req = $pdo->prepare('SELECT owner FROM inventory_categories WHERE id = :id AND owner IS NOT NULL AND team = :team');
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $owner = $req->fetchColumn();
    if ($owner === false || ((int) $owner !== $userId && !$App->Users->isAdmin)) {
        respond(403, array('error' => 'This is not one of your personal modules.'));
    }
    return (int) $owner;
};

try {
    $action = (string) ($payload['action'] ?? '');
    if ($action === 'create') {
        $title = $cleanTitle($payload['title'] ?? '');
        if (!$titleIsFree($title, 0, $userId)) {
            respond(400, array('error' => 'A module with this name exists already.'));
        }
        $fields = null;
        $settings = null;
        $copyFrom = (int) ($payload['copy_from'] ?? 0);
        if ($copyFrom > 0) {
            $src = $pdo->prepare('SELECT fields, settings FROM inventory_categories WHERE id = :id AND team = :team AND state = 1 AND (owner IS NULL OR owner = :me)');
            $src->bindValue(':id', $copyFrom, PDO::PARAM_INT);
            $src->bindValue(':team', $teamId, PDO::PARAM_INT);
            $src->bindValue(':me', $userId, PDO::PARAM_INT);
            $pdo->execute($src);
            $found = $src->fetch(PDO::FETCH_ASSOC);
            if (!is_array($found)) {
                respond(404, array('error' => 'The module to copy was not found.'));
            }
            $fields = $found['fields'];
            $settings = $found['settings'];
        }
        $req = $pdo->prepare('INSERT INTO inventory_categories (team, title, color, is_private, ordering, state, fields, settings, owner)
            VALUES (:team, :title, :color, 0, 1000, 1, :fields, :settings, :owner)');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':color', $cleanColor($payload['color'] ?? ''));
        $req->bindValue(':fields', $fields);
        $req->bindValue(':settings', $settings);
        $req->bindValue(':owner', $userId, PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('id' => (int) $pdo->lastInsertId()));
    }
    $id = (int) ($payload['id'] ?? 0);
    $ownerId = $ownOrExplode($id);
    if ($action === 'update') {
        if (isset($payload['title'])) {
            $title = $cleanTitle($payload['title']);
            if (!$titleIsFree($title, $id, $ownerId)) {
                respond(400, array('error' => 'A module with this name exists already.'));
            }
            $req = $pdo->prepare('UPDATE inventory_categories SET title = :title WHERE id = :id AND owner = :me');
            $req->bindValue(':title', $title);
            $req->bindValue(':id', $id, PDO::PARAM_INT);
            $req->bindValue(':me', $ownerId, PDO::PARAM_INT);
            $pdo->execute($req);
        }
        if (isset($payload['color'])) {
            $req = $pdo->prepare('UPDATE inventory_categories SET color = :color WHERE id = :id AND owner = :me');
            $req->bindValue(':color', $cleanColor($payload['color']));
            $req->bindValue(':id', $id, PDO::PARAM_INT);
            $req->bindValue(':me', $ownerId, PDO::PARAM_INT);
            $pdo->execute($req);
        }
        respond(200, array('ok' => true));
    }
    if ($action === 'delete') {
        // the name of the module has to be sent back: a stray request cannot remove one
        $named = $pdo->prepare('SELECT title FROM inventory_categories WHERE id = :id AND owner = :me');
        $named->bindValue(':id', $id, PDO::PARAM_INT);
        $named->bindValue(':me', $ownerId, PDO::PARAM_INT);
        $pdo->execute($named);
        $title = $named->fetchColumn();
        if ($title === false || trim((string) ($payload['confirm_title'] ?? '')) !== trim((string) $title)) {
            respond(400, array('error' => 'Type the name of the module to remove it.'));
        }
        $count = $pdo->prepare('SELECT COUNT(*) FROM inventory WHERE category = :id AND state <> 3');
        $count->bindValue(':id', $id, PDO::PARAM_INT);
        $pdo->execute($count);
        if ((int) $count->fetchColumn() > 0) {
            respond(400, array('error' => 'This module still has entries: move or delete them first.'));
        }
        $req = $pdo->prepare('DELETE FROM inventory_categories WHERE id = :id AND owner = :me');
        $req->bindValue(':id', $id, PDO::PARAM_INT);
        $req->bindValue(':me', $ownerId, PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('ok' => true));
    }
    respond(400, array('error' => 'Unknown action.'));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
