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

use Elabftw\Models\Inventory;
use PDO;
use Throwable;

use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function json_decode;
use function json_encode;
use function trim;

/**
 * The planned entries of the database: plasmids, primers, stocks that are not made or ordered yet. They are private to their
 * owner, kept out of the lists of the database and have no number until they are marked ready; then they get the next number of
 * their module (each module counts on its own).
 *
 * GET gives the entries of the requester: the ones without a number first (planned and intermediates), then the registered ones.
 * POST {action: plan, title, category} makes a planned entry; {action: status, id, status} sets its status (Planned, Ordered,
 * Being made); {action: register, id} gives a number to an entry of the Database that has none (an intermediate), when it has
 * what its module requires; {action: ready, id} moves it into the Database (it keeps the number it had before, else gets the next one of its
 * module); {action: revert, id} takes an entry of the Database back to the planned ones, keeping its number.
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
$teamId = (int) $App->Users->userData['team'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        respond(403, array('error' => 'Invalid token.'));
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    try {
        $action = (string) ($payload['action'] ?? '');
        if ($action === 'plan') {
            $title = trim((string) ($payload['title'] ?? ''));
            $category = (int) ($payload['category'] ?? 0);
            if ($title === '' || $category <= 0) {
                respond(400, array('error' => 'A title and a module are needed.'));
            }
            $Inventory = new Inventory($App->Users);
            $Inventory->asPlanned = true;
            $id = $Inventory->create(title: $title, category: $category, status: $Inventory->plannedStatusId('Planned'));
            respond(200, array('id' => $id));
        }
        if ($action === 'intermediate') {
            $title = trim((string) ($payload['title'] ?? ''));
            $category = (int) ($payload['category'] ?? 0);
            if ($title === '' || $category <= 0) {
                respond(400, array('error' => 'A title and a module are needed.'));
            }
            $Inventory = new Inventory($App->Users);
            $Inventory->asUnregistered = true;
            respond(200, array('id' => $Inventory->create(title: $title, category: $category)));
        }
        if ($action === 'status') {
            $id = (int) ($payload['id'] ?? 0);
            new Inventory($App->Users, $id)->setPlannedStatus((string) ($payload['status'] ?? ''));
            respond(200, array('id' => $id));
        }
        if ($action === 'register') {
            $id = (int) ($payload['id'] ?? 0);
            $number = new Inventory($App->Users, $id)->register();
            respond(200, array('id' => $id, 'number' => $number));
        }
        if ($action === 'lab') {
            // an entry goes into the lab Database: a planned one is moved, one that is not registered yet is registered
            $id = (int) ($payload['id'] ?? 0);
            $Entry = new Inventory($App->Users, $id);
            $number = (int) ($Entry->entityData['is_planned'] ?? 0) === 1 ? $Entry->markReady() : $Entry->register();
            respond(200, array('id' => $id, 'number' => $number));
        }
        if ($action === 'personal') {
            $id = (int) ($payload['id'] ?? 0);
            $number = new Inventory($App->Users, $id)->registerPersonal();
            respond(200, array('id' => $id, 'number' => $number));
        }
        if ($action === 'revert') {
            $id = (int) ($payload['id'] ?? 0);
            new Inventory($App->Users, $id)->markPlanned();
            respond(200, array('id' => $id));
        }
        if ($action === 'ready') {
            $id = (int) ($payload['id'] ?? 0);
            $number = new Inventory($App->Users, $id)->markReady();
            respond(200, array('id' => $id, 'number' => $number));
        }
        respond(400, array('error' => 'Unknown action.'));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage() !== '' ? $e->getMessage() : $e::class . ' at ' . $e->getFile() . ':' . $e->getLine()));
    }
}

$req = $pdo->prepare('SELECT i.id, i.title, i.is_planned, i.category, c.title AS category_title, c.color AS category_color, i.date, i.custom_id, i.personal_id, s.title AS status_title, s.color AS status_color
    FROM inventory AS i LEFT JOIN inventory_categories AS c ON c.id = i.category LEFT JOIN inventory_status AS s ON s.id = i.status
    WHERE i.userid = :userid AND i.team = :team AND i.state = 1
    ORDER BY (i.is_planned = 0 AND i.custom_id IS NOT NULL), i.id DESC LIMIT 300');
$req->bindValue(':userid', $userId, PDO::PARAM_INT);
$req->bindValue(':team', $teamId, PDO::PARAM_INT);
$pdo->execute($req);
respond(200, array('planned' => $req->fetchAll(PDO::FETCH_ASSOC)));
