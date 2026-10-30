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

use Elabftw\Models\Changelog;
use Elabftw\Models\Inventory;
use Elabftw\Params\ContentParams;
use PDO;
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
use function implode;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function preg_match;
use function round;
use function sprintf;
use function strlen;
use function strtoupper;

/**
 * The primers attached to the plasmids of the database. A primer is an entry of the database (a module of primers) and can be
 * attached to any number of plasmids; where it binds is worked out from the sequence of the plasmid, in the browser.
 *
 * GET ?entry=<id> gives the primers attached to the entry and the entries it is attached to (as a primer).
 * GET ?orders=1 gives the open orders of the team, to pick the one a primer is sent to.
 * POST {action: attach|detach, plasmid: <id>, primer: <id>} attaches or detaches; whoever can read both entries can do it,
 * like the storage of an entry.
 * POST {action: order, primers: [<id>], order: <id>} links primers to an order of the team and, when the requester owns the
 * order, adds their sequences to its notes: whoever can read the primers can send them.
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

/**
 * A quick estimate of the melting temperature, like the one of the editor
 */
function estimateTm(string $sequence): ?float
{
    $bases = preg_replace('/[^A-Z]/', '', strtoupper($sequence)) ?? '';
    $length = strlen($bases);
    if ($length === 0) {
        return null;
    }
    $gc = preg_match_all('/[GC]/', $bases);
    if ($length < 14) {
        return (float) (2 * ($length - $gc) + 4 * $gc);
    }
    return round(64.9 + (41 * ($gc - 16.4)) / $length, 1);
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
        $lines = array();
        foreach ($primerIds as $primerId) {
            $primerEntry = describe($App, $primerId);
            if ($primerEntry === null) {
                continue;
            }
            $link = $pdo->prepare('INSERT IGNORE INTO entity_order_links (entity_type, entity_id, order_id) VALUES (:type, :id, :order)');
            $link->bindValue(':type', 'inventory');
            $link->bindValue(':id', $primerId, PDO::PARAM_INT);
            $link->bindValue(':order', $orderId, PDO::PARAM_INT);
            $pdo->execute($link);
            // a primer is written in the notes once
            if ($link->rowCount() > 0 && $primerEntry['sequence'] !== '') {
                // the melting temperature written on the primer, else a quick estimate
                $tm = $primerEntry['tm'] ?? estimateTm($primerEntry['sequence']);
                $lines[] = sprintf("%s: 5'-%s-3'%s", $primerEntry['title'], $primerEntry['sequence'], $tm === null ? '' : sprintf(' (Tm %s C)', $tm));
            }
        }
        $notesAdded = false;
        // the notes of an order are those of its owner (or of an admin)
        if ($lines !== array() && ((int) $order['userid'] === $userId || $App->Users->isAdmin)) {
            $update = $pdo->prepare("UPDATE custom_orders SET notes = CONCAT(IFNULL(notes, ''), IF(IFNULL(notes, '') = '', '', '\n'), :lines) WHERE id = :id");
            $update->bindValue(':lines', implode("\n", $lines));
            $update->bindValue(':id', $orderId, PDO::PARAM_INT);
            $pdo->execute($update);
            $notesAdded = true;
        }
        respond(200, array('ok' => true, 'linked' => count($primerIds), 'notesAdded' => $notesAdded, 'order' => array('id' => $orderId, 'title' => (string) $order['title'])));
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
