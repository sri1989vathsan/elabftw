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
use function is_array;
use function json_decode;
use function json_encode;
use function mb_substr;
use function trim;

/**
 * Information about the storage places: where each is, its conditions, who looks after it, notes.
 *
 * GET ?id=N gives the information of one place, with whether the user can edit it and the users that can be the contact;
 * GET ?all=1 gives the information of every place that has some, by id (for the pages of the entries).
 * POST {storage_id, location, conditions, contact, notes} saves it, for whoever can edit the storage places.
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
// the same rule as the editing of the storage places: everyone, or only those who were given the right
$canEdit = (int) ($App->Users->userData['can_manage_inventory_locations'] ?? 0) === 1 || (int) ($App->Config->configArr['inventory_require_edit_rights'] ?? 0) !== 1;

$select = 'SELECT i.storage_id, i.location, i.conditions, i.contact_users_id, i.notes, CONCAT(u.firstname, " ", u.lastname) AS contact_name
    FROM storage_unit_info AS i LEFT JOIN users AS u ON u.userid = i.contact_users_id';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    if (isset($_GET['all'])) {
        $req = $pdo->prepare($select . " WHERE i.location <> '' OR i.conditions <> '' OR i.contact_users_id IS NOT NULL");
        $pdo->execute($req);
        $all = array();
        foreach ($req->fetchAll() as $row) {
            $all[(string) $row['storage_id']] = array('location' => (string) $row['location'], 'conditions' => (string) $row['conditions'], 'contact_name' => trim((string) $row['contact_name']));
        }
        respond(200, array('info' => (object) $all));
    }
    $req = $pdo->prepare($select . ' WHERE i.storage_id = :id');
    $req->bindValue(':id', (int) ($_GET['id'] ?? 0), PDO::PARAM_INT);
    $pdo->execute($req);
    $row = $req->fetch();
    $users = $pdo->prepare('SELECT u.userid AS id, CONCAT(u.firstname, " ", u.lastname) AS name FROM users AS u INNER JOIN users2teams AS t ON t.users_id = u.userid WHERE t.teams_id = :team AND t.is_archived = 0 AND u.archived = 0 ORDER BY u.firstname, u.lastname');
    $users->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($users);
    respond(200, array(
        'info' => is_array($row) ? array('location' => (string) $row['location'], 'conditions' => (string) $row['conditions'], 'contact' => $row['contact_users_id'] !== null ? (int) $row['contact_users_id'] : null, 'contact_name' => trim((string) $row['contact_name']), 'notes' => (string) ($row['notes'] ?? '')) : array('location' => '', 'conditions' => '', 'contact' => null, 'contact_name' => '', 'notes' => ''),
        'can_edit' => $canEdit,
        'users' => $users->fetchAll(),
    ));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
if (!$canEdit) {
    respond(403, array('error' => 'You were not given the right to edit the storage places.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
try {
    $storageId = is_array($payload) ? (int) ($payload['storage_id'] ?? 0) : 0;
    $exists = $pdo->prepare('SELECT COUNT(*) FROM storage_units WHERE id = :id');
    $exists->bindValue(':id', $storageId, PDO::PARAM_INT);
    $pdo->execute($exists);
    if ($storageId <= 0 || (int) $exists->fetchColumn() === 0) {
        respond(404, array('error' => 'This storage place does not exist.'));
    }
    $contact = (int) ($payload['contact'] ?? 0);
    $req = $pdo->prepare('INSERT INTO storage_unit_info (storage_id, location, conditions, contact_users_id, notes) VALUES (:id, :location, :conditions, :contact, :notes)
        ON DUPLICATE KEY UPDATE location = VALUES(location), conditions = VALUES(conditions), contact_users_id = VALUES(contact_users_id), notes = VALUES(notes)');
    $req->bindValue(':id', $storageId, PDO::PARAM_INT);
    $req->bindValue(':location', mb_substr(trim((string) ($payload['location'] ?? '')), 0, 255));
    $req->bindValue(':conditions', mb_substr(trim((string) ($payload['conditions'] ?? '')), 0, 255));
    $req->bindValue(':contact', $contact > 0 ? $contact : null, $contact > 0 ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $req->bindValue(':notes', mb_substr(trim((string) ($payload['notes'] ?? '')), 0, 5000));
    $pdo->execute($req);
    respond(200, array('ok' => true));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
