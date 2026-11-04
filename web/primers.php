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
use Elabftw\Enums\Storage;
use Elabftw\Models\Changelog;
use Elabftw\Models\ExperimentsFolders;
use Elabftw\Models\Inventory;
use Elabftw\Params\ContentParams;
use PDO;
use RuntimeException;
use Throwable;

use function array_map;
use function readfile;
use function unlink;
use function gmdate;
use function array_unique;
use function array_values;
use function count;
use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function preg_match;
use function sprintf;

/**
 * The primers attached to the plasmids of the database. A primer is an entry of the database (a module of primers) and can be
 * attached to any number of plasmids; where it binds is worked out from the sequence of the plasmid, in the browser.
 *
 * GET ?entry=<id> gives the primers attached to the entry and the entries it is attached to (as a primer).
 * GET ?list=1 gives every primer and probe the requester can read (id, name, bases, module), for the search on a sequence.
 * GET ?orders=1 gives the open orders of the team, to pick the one a primer is sent to.
 * POST {action: attach|detach, plasmid: <id>, primer: <id>} attaches or detaches; whoever can read both entries can do it,
 * like the storage of an entry.
 * POST {action: order, primers: [<id>], order: <id>} links primers to an order of the team: whoever can read the primers can
 * send them. The sequences go to the supplier in the order sheet (GET ?sheet=), not in the notes of the order.
 */
require_once __DIR__ . '/app/init.inc.php';
require_once __DIR__ . '/order-sheets/sheets.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

/**
 * The entry as shown with its primers, null when it cannot be read by the requester
 *
 * @return array{id: int, title: string, category: string, color: string, sequence: string, orientation: string, tm: float|null}|null
 */
function describe(App $App, int $id): ?array
{
    try {
        $data = new Inventory($App->Users, $id)->readOne();
    } catch (Throwable) {
        return null;
    }
    $sequence = '';
    $orientation = '';
    $tm = null;
    $metadata = json_decode((string) ($data['metadata'] ?? ''), true);
    foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
        if (!is_array($field)) {
            continue;
        }
        if (preg_match('/^sequence/i', (string) $name) === 1) {
            $sequence = (string) ($field['value'] ?? '');
        } elseif (preg_match('/^orientation/i', (string) $name) === 1) {
            $orientation = (string) ($field['value'] ?? '');
        } elseif (preg_match('/^tm/i', (string) $name) === 1 && is_numeric($field['value'] ?? null)) {
            $tm = (float) $field['value'];
        }
    }
    return array(
        'id' => $id,
        'title' => (string) ($data['title'] ?? ''),
        'category' => (string) ($data['category_title'] ?? ''),
        'color' => (string) ($data['category_color'] ?? ''),
        'sequence' => $sequence,
        'orientation' => $orientation,
        'tm' => $tm,
    );
}

$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$userId = (int) $App->Users->userData['userid'];

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        respond(403, array('error' => 'Invalid token.'));
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $action = (string) ($payload['action'] ?? '');
    if ($action === 'order') {
        $orderId = (int) ($payload['order'] ?? 0);
        $primerIds = array_values(array_unique(array_map('intval', is_array($payload['primers'] ?? null) ? $payload['primers'] : array())));
        if ($orderId <= 0 || $primerIds === array() || count($primerIds) > 200) {
            respond(400, array('error' => 'Invalid request.'));
        }
        // the order has to be one of the team, that the requester can see
        $req = $pdo->prepare("SELECT id, userid, title FROM custom_orders WHERE id = :id AND team = :team AND (status <> 'my_reference' OR userid = :userid)");
        $req->bindValue(':id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':userid', $userId, PDO::PARAM_INT);
        $pdo->execute($req);
        $order = $req->fetch();
        if (!is_array($order)) {
            respond(404, array('error' => 'Order not found in this team.'));
        }
        foreach ($primerIds as $primerId) {
            if (describe($App, $primerId) === null) {
                continue;
            }
            $link = $pdo->prepare('INSERT IGNORE INTO entity_order_links (entity_type, entity_id, order_id) VALUES (:type, :id, :order)');
            $link->bindValue(':type', 'inventory');
            $link->bindValue(':id', $primerId, PDO::PARAM_INT);
            $link->bindValue(':order', $orderId, PDO::PARAM_INT);
            $pdo->execute($link);
        }
        respond(200, array('ok' => true, 'linked' => count($primerIds), 'order' => array('id' => $orderId, 'title' => (string) $order['title'])));
    }
    if ($action === 'file') {
        // a primer designed in the editor is filed in the folder of its plasmid, in a subfolder "Primers"
        $primerId = (int) ($payload['primer'] ?? 0);
        $plasmidId = (int) ($payload['plasmid'] ?? 0);
        if ($primerId <= 0 || $plasmidId <= 0) {
            respond(400, array('error' => 'Invalid request.'));
        }
        $primerEntry = new Inventory($App->Users, $primerId);
        $primerEntry->canOrExplode(AccessType::Write);
        $plasmidEntry = new Inventory($App->Users, $plasmidId);
        $folderId = (int) ($plasmidEntry->entityData['folder_id'] ?? 0);
        // a plasmid of the Database sits in the folders of the Database: nothing is filed there, only the user's own folders get a "Primers" subfolder
        if ($folderId <= 0 || (($plasmidEntry->entityData['custom_id'] ?? null) !== null && (int) ($plasmidEntry->entityData['is_planned'] ?? 0) === 0)) {
            respond(200, array('ok' => true, 'filed' => false));
        }
        $find = $pdo->prepare("SELECT id FROM experiments_folders WHERE team = :team AND scope = 'inventory' AND name = 'Primers' AND parent_id = :parent LIMIT 1");
        $find->bindValue(':team', $teamId, PDO::PARAM_INT);
        $find->bindValue(':parent', $folderId, PDO::PARAM_INT);
        $pdo->execute($find);
        $Folders = new ExperimentsFolders($App->Users, null, 'inventory');
        $subfolder = (int) $find->fetchColumn();
        if ($subfolder <= 0) {
            $subfolder = $Folders->create('Primers', $folderId);
        }
        $Folders->assignInventory($primerId, $subfolder);
        respond(200, array('ok' => true, 'filed' => true, 'folder' => $subfolder));
    }
    $plasmid = (int) ($payload['plasmid'] ?? 0);
    $primer = (int) ($payload['primer'] ?? 0);
    if ($plasmid <= 0 || $primer <= 0 || $plasmid === $primer || !in_array($action, array('attach', 'detach'), true)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    try {
        $Plasmid = new Inventory($App->Users, $plasmid);
        $Plasmid->readOne();
        $Primer = new Inventory($App->Users, $primer);
        $Primer->readOne();
    } catch (Throwable) {
        respond(403, array('error' => 'You cannot open these entries.'));
    }
    if ($action === 'attach') {
        $req = $pdo->prepare('INSERT IGNORE INTO inventory_primer_links (plasmid_id, primer_id, users_id) VALUES (:plasmid, :primer, :userid)');
        $req->bindValue(':userid', (int) $App->Users->userData['userid'], PDO::PARAM_INT);
    } else {
        $req = $pdo->prepare('DELETE FROM inventory_primer_links WHERE plasmid_id = :plasmid AND primer_id = :primer');
    }
    $req->bindValue(':plasmid', $plasmid, PDO::PARAM_INT);
    $req->bindValue(':primer', $primer, PDO::PARAM_INT);
    $pdo->execute($req);
    $verb = $action === 'attach' ? 'attached to' : 'detached from';
    new Changelog($Plasmid)->create(new ContentParams('primers', sprintf('Primer #%d %s this plasmid', $primer, $verb)));
    new Changelog($Primer)->create(new ContentParams('primers', sprintf('Primer %s plasmid #%d', $verb, $plasmid)));
    respond(200, array('ok' => true));
}

if (isset($_GET['list'])) {
    // every primer and probe the requester can read, with only what the search needs (name, bases, module), in one request: the
    // search on the sequence is done in the browser and there can be many thousands of them
    $canFilter = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
    $req = $pdo->prepare("SELECT entity.id, entity.title, entity.metadata, c.title AS category_title, c.color AS category_color
        FROM inventory AS entity
        INNER JOIN inventory_categories AS c ON c.id = entity.category
        WHERE entity.state = 1 AND entity.is_planned = 0 AND entity.team = :team
            AND c.title REGEXP '^(primers?|probes?)$'" . $canFilter . ' ORDER BY entity.id');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':userid', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $primers = array();
    foreach ($req->fetchAll() as $row) {
        $metadata = json_decode((string) ($row['metadata'] ?? ''), true);
        $sequence = '';
        foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
            if (is_array($field) && preg_match('/^sequence/i', (string) $name) === 1) {
                $sequence = (string) ($field['value'] ?? '');
                break;
            }
        }
        if ($sequence === '') {
            continue;
        }
        $primers[] = array('id' => (int) $row['id'], 'title' => (string) $row['title'], 'sequence' => $sequence, 'category' => (string) $row['category_title'], 'color' => (string) $row['category_color']);
    }
    respond(200, array('primers' => $primers));
}
if (isset($_GET['order_sheet'])) {
    // the oligos of a sheet attached to an order of the team: GET ?order_sheet=1&order=<id>&f=<long name of the file>
    $orderId = (int) ($_GET['order'] ?? 0);
    $req = $pdo->prepare("SELECT u.real_name, u.long_name, u.storage FROM custom_order_uploads AS u INNER JOIN custom_orders AS o ON o.id = u.order_id AND o.team = :team WHERE u.order_id = :order AND u.long_name = :f AND (o.status <> 'my_reference' OR o.userid = :userid)");
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $req->bindValue(':order', $orderId, PDO::PARAM_INT);
    $req->bindValue(':f', (string) ($_GET['f'] ?? ''));
    $req->bindValue(':userid', $userId, PDO::PARAM_INT);
    $pdo->execute($req);
    $file = $req->fetch();
    if (!is_array($file) || preg_match('/\.xlsx$/i', (string) $file['real_name']) !== 1) {
        respond(404, array('error' => 'This file is not a sheet of this order.'));
    }
    $temporary = tempnam(sys_get_temp_dir(), 'ordersheet');
    try {
        if ($temporary === false) {
            throw new RuntimeException('The sheet could not be read.');
        }
        file_put_contents($temporary, Storage::from((int) $file['storage'])->getStorage()->getFs()->read((string) $file['long_name']));
        respond(200, array('name' => (string) $file['real_name'], 'oligos' => readOrderSheet($temporary)));
    } catch (Throwable $e) {
        respond(422, array('error' => $e->getMessage()));
    } finally {
        if (is_string($temporary)) {
            @unlink($temporary);
        }
    }
}

if (isset($_GET['sheet'])) {
    // the order sheet of a supplier with the names and sequences of primers: GET ?sheet=idt|microsynth&ids=1,2&scale=&purification=
    $vendor = ORDER_SHEET_VENDORS[(string) $_GET['sheet']] ?? null;
    $ids = array_values(array_unique(array_map('intval', explode(',', (string) ($_GET['ids'] ?? '')))));
    if ($vendor === null || $ids === array() || count($ids) > 200) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $scale = in_array((string) ($_GET['scale'] ?? ''), $vendor['scales'], true) ? (string) $_GET['scale'] : $vendor['scale'];
    $purification = in_array((string) ($_GET['purification'] ?? ''), $vendor['purifications'], true) ? (string) $_GET['purification'] : $vendor['purification'];
    $oligos = array();
    foreach ($ids as $id) {
        $described = $id > 0 ? describe($App, $id) : null;
        $bases = $described === null ? '' : cleanOligoSequence($described['sequence']);
        if ($described !== null && $bases !== '') {
            $oligos[] = array('name' => $_GET['sheet'] === 'microsynth' ? microsynthName($described['title']) : $described['title'], 'sequence' => $bases);
        }
    }
    if ($oligos === array()) {
        respond(404, array('error' => 'None of these primers has a sequence.'));
    }
    try {
        $file = $_GET['sheet'] === 'microsynth' ? microsynthSheet($oligos, $scale, $purification) : idtSheet($oligos, $scale, $purification);
    } catch (Throwable $e) {
        respond(500, array('error' => $e->getMessage()));
    }
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header(sprintf('Content-Disposition: attachment; filename="oligo-order-%s-%s.xlsx"', (string) $_GET['sheet'], gmdate('Y-m-d')));
    readfile($file);
    unlink($file);
    exit;
}

if (($_GET['orders'] ?? '') === '1') {
    $req = $pdo->prepare("SELECT id, title, status FROM custom_orders WHERE team = :team AND archived = 0 AND status IN ('requested', 'backlogged') ORDER BY created_at DESC LIMIT 40");
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    respond(200, array('orders' => $req->fetchAll()));
}

$entryId = (int) ($_GET['entry'] ?? 0);
$entry = $entryId > 0 ? describe($App, $entryId) : null;
if ($entry === null) {
    respond(403, array('error' => 'You cannot open this entry.'));
}

$related = static function (string $selected, string $where) use ($pdo, $App, $entryId): array {
    $req = $pdo->prepare(sprintf('SELECT %s AS other FROM inventory_primer_links WHERE %s = :id ORDER BY created_at', $selected, $where));
    $req->bindValue(':id', $entryId, PDO::PARAM_INT);
    $pdo->execute($req);
    $found = array();
    foreach ($req->fetchAll(PDO::FETCH_COLUMN) as $id) {
        $described = describe($App, (int) $id);
        if ($described !== null) {
            $found[] = $described;
        }
    }
    return $found;
};

$req = $pdo->prepare("SELECT o.id, o.title, o.status FROM entity_order_links AS l INNER JOIN custom_orders AS o ON o.id = l.order_id AND o.team = :team WHERE l.entity_type = 'inventory' AND l.entity_id = :id AND (o.status <> 'my_reference' OR o.userid = :userid) ORDER BY l.created_at");
$req->bindValue(':team', $teamId, PDO::PARAM_INT);
$req->bindValue(':id', $entryId, PDO::PARAM_INT);
$req->bindValue(':userid', $userId, PDO::PARAM_INT);
$pdo->execute($req);
$orders = $req->fetchAll();

respond(200, array(
    'entry' => $entry,
    'orders' => $orders,
    // when the entry is a plasmid: its primers
    'primers' => $related('primer_id', 'plasmid_id'),
    // when the entry is a primer: the plasmids it is attached to
    'plasmids' => $related('plasmid_id', 'primer_id'),
));
