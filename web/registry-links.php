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
use Elabftw\Models\Experiments;
use Elabftw\Models\Inventory;
use Elabftw\Models\Items;
use Elabftw\Services\CanSqlBuilder;
use PDO;
use Throwable;

use function ctype_digit;
use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_substr;
use function str_replace;
use function trim;

/**
 * Entries of the database linked to experiments and resources.
 *
 * GET ?entity=experiments|items&id=N gives the entries linked to an experiment or a resource;
 * GET ?search=text gives entries to link (by title, number or module); GET ?used_in=ID gives the experiments and resources that link an entry.
 * POST {action: add|remove, entity, id, inventory_id} links or unlinks.
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
$TYPES = array('experiments', 'items');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $canRead = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
    // the entries of the database that can be read: the lab Database, and the entries of the user
    $visible = '(entity.is_planned = 0 AND entity.custom_id IS NOT NULL OR entity.userid = :userid)';
    $select = 'SELECT entity.id, entity.title, entity.custom_id, entity.personal_id, c.title AS module, c.color AS color
        FROM inventory AS entity LEFT JOIN inventory_categories AS c ON c.id = entity.category';
    if (isset($_GET['search'])) {
        $text = trim(mb_substr((string) $_GET['search'], 0, 100));
        if ($text === '') {
            respond(200, array('entries' => array()));
        }
        $like = '%' . str_replace(array('%', '_'), array('\\%', '\\_'), $text) . '%';
        $number = ctype_digit($text) ? (int) $text : 0;
        $req = $pdo->prepare($select . ' WHERE entity.state = 1 AND entity.team = :team AND ' . $visible . $canRead . '
            AND (entity.title LIKE :like OR c.title LIKE :like OR (:number > 0 AND entity.custom_id = :number) OR entity.metadata LIKE :like)
            ORDER BY entity.custom_id IS NULL, entity.custom_id DESC, entity.id DESC LIMIT 15');
        $req->bindValue(':like', $like);
        $req->bindValue(':number', $number, PDO::PARAM_INT);
    } elseif (isset($_GET['used_in'])) {
        $inventoryId = (int) $_GET['used_in'];
        new Inventory($App->Users, $inventoryId)->readOne();
        $used = array();
        foreach ($TYPES as $type) {
            $table = $type;
            $filter = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
            $links = $pdo->prepare('SELECT entity.id, entity.title FROM ' . $table . ' AS entity
                INNER JOIN inventory_entity_links AS l ON l.entity_id = entity.id AND l.entity_type = :type
                WHERE l.inventory_id = :inventory AND entity.state = 1' . $filter . ' ORDER BY entity.id DESC LIMIT 50');
            $links->bindValue(':type', $type);
            $links->bindValue(':inventory', $inventoryId, PDO::PARAM_INT);
            $links->bindValue(':userid', $userId, PDO::PARAM_INT);
            $links->bindValue(':team', $teamId, PDO::PARAM_INT);
            try {
                $pdo->execute($links);
            } catch (Throwable) {
                continue;
            }
            foreach ($links->fetchAll() as $row) {
                $used[] = array('type' => $type, 'id' => (int) $row['id'], 'title' => (string) $row['title']);
            }
        }
        respond(200, array('used_in' => $used));
    } else {
        $type = (string) ($_GET['entity'] ?? '');
        if (!in_array($type, $TYPES, true)) {
            respond(400, array('error' => 'Invalid request.'));
        }
        $req = $pdo->prepare($select . ' INNER JOIN inventory_entity_links AS l ON l.inventory_id = entity.id AND l.entity_type = :type AND l.entity_id = :id
            WHERE entity.state = 1 AND entity.team = :team AND ' . $visible . $canRead . ' ORDER BY l.id');
        $req->bindValue(':type', $type);
        $req->bindValue(':id', (int) ($_GET['id'] ?? 0), PDO::PARAM_INT);
    }
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':userid', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    respond(200, array('entries' => $req->fetchAll()));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
$action = is_array($payload) ? (string) ($payload['action'] ?? '') : '';
$type = is_array($payload) ? (string) ($payload['entity'] ?? '') : '';
$entityId = is_array($payload) ? (int) ($payload['id'] ?? 0) : 0;
$inventoryId = is_array($payload) ? (int) ($payload['inventory_id'] ?? 0) : 0;
if (!in_array($action, array('add', 'remove'), true) || !in_array($type, $TYPES, true) || $entityId <= 0 || $inventoryId <= 0) {
    respond(400, array('error' => 'Invalid request.'));
}
try {
    // whoever can edit the experiment or the resource can link, to an entry they can read
    $Entity = $type === 'experiments' ? new Experiments($App->Users, $entityId) : new Items($App->Users, $entityId);
    $Entity->canOrExplode(AccessType::Write);
    new Inventory($App->Users, $inventoryId)->readOne();
    if ($action === 'add') {
        $req = $pdo->prepare('INSERT IGNORE INTO inventory_entity_links (entity_type, entity_id, inventory_id, users_id) VALUES (:type, :entity, :inventory, :user)');
        $req->bindValue(':user', $userId, PDO::PARAM_INT);
    } else {
        $req = $pdo->prepare('DELETE FROM inventory_entity_links WHERE entity_type = :type AND entity_id = :entity AND inventory_id = :inventory');
    }
    $req->bindValue(':type', $type);
    $req->bindValue(':entity', $entityId, PDO::PARAM_INT);
    $req->bindValue(':inventory', $inventoryId, PDO::PARAM_INT);
    $pdo->execute($req);
    respond(200, array('ok' => true));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
