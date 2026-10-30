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
use Elabftw\Models\Changelog;
use Elabftw\Models\Inventory;
use Elabftw\Params\ContentParams;
use PDO;
use Throwable;

use function array_map;
use function array_shift;
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
use function sprintf;

/**
 * The lineage of the entries of the database: parents (what an entry was made from) and daughters (what was made from it).
 * A link from an entry to another one in inventory2inventory means "the first one comes from the second one".
 *
 * GET ?entry=<id> gives the parents, the daughters and the family (ancestors and descendants, a few generations).
 * POST {action: add|remove, entry: <daughter>, parent: <parent>} adds or removes a link, the daughter must be editable.
 */
require_once __DIR__ . '/app/init.inc.php';

const GENERATIONS = 4;
const MAX_NODES = 80;

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

/**
 * @return array<int, int>
 */
function neighbours(Db $db, int $id, bool $up): array
{
    $sql = $up
        ? 'SELECT link_id AS other FROM inventory2inventory WHERE item_id = :id'
        : 'SELECT item_id AS other FROM inventory2inventory WHERE link_id = :id';
    $req = $db->prepare($sql);
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $db->execute($req);
    return array_map('intval', $req->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * The entry as shown in the lineage, null when it cannot be read by the requester
 *
 * @return array{id: int, title: string, category: string, color: string, canWrite: bool}|null
 */
function describe(App $App, int $id): ?array
{
    try {
        $Entry = new Inventory($App->Users, $id);
        $data = $Entry->readOne();
    } catch (Throwable) {
        return null;
    }
    $canWrite = false;
    try {
        $Entry->canOrExplode(AccessType::Write);
        $canWrite = !$Entry->isReadOnly;
    } catch (Throwable) {
        $canWrite = false;
    }
    return array(
        'id' => $id,
        'title' => (string) ($data['title'] ?? ''),
        'category' => (string) ($data['category_title'] ?? ''),
        'color' => (string) ($data['category_color'] ?? ''),
        'canWrite' => $canWrite,
    );
}

$pdo = Db::getConnection();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        respond(403, array('error' => 'Invalid token.'));
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        respond(400, array('error' => 'Invalid request.'));
    }
    $child = (int) ($payload['entry'] ?? 0);
    $parent = (int) ($payload['parent'] ?? 0);
    $action = (string) ($payload['action'] ?? '');
    if ($child <= 0 || $parent <= 0 || $child === $parent || !in_array($action, array('add', 'remove'), true)) {
        respond(400, array('error' => 'Invalid link.'));
    }
    try {
        $Child = new Inventory($App->Users, $child);
        $Child->readOne();
        $Child->canOrExplode(AccessType::Write);
        $Parent = new Inventory($App->Users, $parent);
        $Parent->readOne();
    } catch (Throwable) {
        respond(403, array('error' => 'You cannot edit this entry.'));
    }
    if ($action === 'add') {
        // an entry cannot come from its own descendant
        $seen = array($child => true);
        $queue = array($child);
        while ($queue !== array()) {
            $current = array_shift($queue);
            foreach (neighbours($pdo, $current, false) as $daughter) {
                if ($daughter === $parent) {
                    respond(422, array('error' => 'This would make an entry come from its own descendant.'));
                }
                if (!isset($seen[$daughter]) && count($seen) < 500) {
                    $seen[$daughter] = true;
                    $queue[] = $daughter;
                }
            }
        }
        $req = $pdo->prepare('INSERT IGNORE INTO inventory2inventory (item_id, link_id) VALUES (:child, :parent)');
    } else {
        $req = $pdo->prepare('DELETE FROM inventory2inventory WHERE item_id = :child AND link_id = :parent');
    }
    $req->bindValue(':child', $child, PDO::PARAM_INT);
    $req->bindValue(':parent', $parent, PDO::PARAM_INT);
    $pdo->execute($req);
    $Child->touch();
    new Changelog($Child)->create(new ContentParams(
        'lineage',
        sprintf($action === 'add' ? 'Parent #%d added' : 'Parent #%d removed', $parent),
    ));
    respond(200, array('ok' => true));
}

$entryId = (int) ($_GET['entry'] ?? 0);
$entry = $entryId > 0 ? describe($App, $entryId) : null;
if ($entry === null) {
    respond(403, array('error' => 'You cannot open this entry.'));
}

// the family: ancestors upwards and descendants downwards, a few generations, as nodes and links
$nodes = array($entryId => $entry);
$links = array();
$collect = static function (bool $up) use ($pdo, $App, $entryId, &$nodes, &$links): void {
    $level = array($entryId);
    for ($generation = 1; $generation <= GENERATIONS && $level !== array(); $generation++) {
        $next = array();
        foreach ($level as $id) {
            foreach (neighbours($pdo, $id, $up) as $other) {
                if (count($nodes) >= MAX_NODES && !isset($nodes[$other])) {
                    continue;
                }
                if (!isset($nodes[$other])) {
                    $described = describe($App, $other);
                    if ($described === null) {
                        continue;
                    }
                    $nodes[$other] = $described;
                    $next[] = $other;
                }
                // a link goes from the daughter to the parent
                $links[$up ? $id . '-' . $other : $other . '-' . $id] = $up ? array($id, $other) : array($other, $id);
            }
        }
        $level = array_values(array_unique($next));
    }
};
$collect(true);
$collect(false);

$parents = array();
foreach (neighbours($pdo, $entryId, true) as $id) {
    if (isset($nodes[$id])) {
        $parents[] = $nodes[$id];
    }
}
$daughters = array();
foreach (neighbours($pdo, $entryId, false) as $id) {
    if (isset($nodes[$id])) {
        $daughters[] = $nodes[$id];
    }
}

respond(200, array(
    'entry' => $entry,
    'parents' => $parents,
    'daughters' => $daughters,
    'nodes' => array_values($nodes),
    'links' => array_values($links),
));
