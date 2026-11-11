<?php

/**
 * Look at the personal modules of one person, read only. Fork-only file.
 *
 * Personal modules are private by default and do not appear in the lists of the Database. Anyone of the team can look at the personal modules of
 * one person at a time, on purpose, with this file; every look is logged and the owner sees it in "My modules...". Admins can also change them
 * (registry-my-modules.php) and open the entries.
 *
 * GET                 gives the personal modules of the others (the entries only of the ones added to the view), to search and add one by one.
 * GET ?add=ID         adds one module to the view and logs it: for 30 minutes (or until ?stop=1&module=ID) it and its entries can be opened in
 *                     the Database like the others, read only (admins can edit).
 * GET ?stop=1         stops looking at all the modules (&module=ID: one, &user=ID: those of a person).
 */
declare(strict_types=1);

namespace Elabftw\Elabftw;

use PDO;
use Throwable;

use function header;
use function http_response_code;
use function array_map;
use function count;
use function implode;
use function is_array;
use function json_decode;
use function json_encode;
use function mb_substr;

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
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    respond(405, array('error' => 'GET only.'));
}
$pdo = Db::getConnection();
$userId = (int) $App->Users->userData['userid'];
$teamId = (int) $App->Users->userData['team'];

try {
    // stop looking at one module (module=ID), at all the modules of a person (user=ID) or at all of them
    if (isset($_GET['stop'])) {
        $stop = $pdo->prepare('UPDATE personal_module_views SET closed_at = NOW() WHERE viewer = :me AND closed_at IS NULL
            AND (:module = 0 OR category = :module2) AND (:owner = 0 OR owner = :owner2)');
        $stop->bindValue(':me', $userId, PDO::PARAM_INT);
        foreach (array(':module' => 'module', ':module2' => 'module', ':owner' => 'user', ':owner2' => 'user') as $name => $key) {
            $stop->bindValue($name, (int) ($_GET[$key] ?? 0), PDO::PARAM_INT);
        }
        $pdo->execute($stop);
        respond(200, array('ok' => true));
    }
    // add one module to the view: logged, but not again for the same module within ten minutes
    $add = (int) ($_GET['add'] ?? 0);
    if ($add > 0) {
        $own = $pdo->prepare('SELECT owner FROM inventory_categories WHERE id = :id AND team = :team AND state = 1 AND owner IS NOT NULL AND owner <> :me');
        $own->bindValue(':id', $add, PDO::PARAM_INT);
        $own->bindValue(':team', $teamId, PDO::PARAM_INT);
        $own->bindValue(':me', $userId, PDO::PARAM_INT);
        $pdo->execute($own);
        $owner = $own->fetchColumn();
        if ($owner === false) {
            respond(404, array('error' => 'This module is not a personal module of someone of your team.'));
        }
        $log = $pdo->prepare('INSERT INTO personal_module_views (viewer, owner, category)
            SELECT :viewer, :owner, :category FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM personal_module_views WHERE viewer = :viewer2 AND category = :category2 AND closed_at IS NULL AND viewed_at > NOW() - INTERVAL 10 MINUTE)');
        $log->bindValue(':viewer', $userId, PDO::PARAM_INT);
        $log->bindValue(':viewer2', $userId, PDO::PARAM_INT);
        $log->bindValue(':owner', (int) $owner, PDO::PARAM_INT);
        $log->bindValue(':category', $add, PDO::PARAM_INT);
        $log->bindValue(':category2', $add, PDO::PARAM_INT);
        $pdo->execute($log);
        respond(200, array('ok' => true, 'id' => $add));
    }
    $entries = $pdo->prepare('SELECT id, title, personal_id, state, date, metadata FROM inventory WHERE category = :id AND state IN (1, 2) ORDER BY title LIMIT 500');
    // what is inside a module, read only: its entries with their fields (name, value)
    $entriesOf = static function (int $moduleId) use ($pdo, $entries): array {
        $entries->bindValue(':id', $moduleId, PDO::PARAM_INT);
        $pdo->execute($entries);
        $out = array();
        foreach ($entries->fetchAll(PDO::FETCH_ASSOC) as $entry) {
            $fields = array();
            $metadata = json_decode((string) $entry['metadata'], true);
            foreach (is_array($metadata) && is_array($metadata['extra_fields'] ?? null) ? $metadata['extra_fields'] : array() as $name => $field) {
                if (is_array($field) && count($fields) < 40) {
                    $value = $field['value'] ?? '';
                    $fields[] = array('name' => (string) $name, 'value' => mb_substr(is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value, 0, 300));
                }
            }
            unset($entry['metadata']);
            $entry['fields'] = $fields;
            $out[] = $entry;
        }
        return $out;
    };
    // all the personal modules of the others, to search and add one by one; the ones added to the view come with their entries
    $req = $pdo->prepare('SELECT c.id, c.title, c.color, u.userid AS owner, CONCAT(u.firstname, " ", u.lastname) AS owner_name,
            (SELECT COUNT(*) FROM inventory AS i WHERE i.category = c.id AND i.state = 1) AS entry_count,
            EXISTS (SELECT 1 FROM personal_module_views AS v WHERE v.category = c.id AND v.viewer = :me AND v.closed_at IS NULL AND v.viewed_at > NOW() - INTERVAL 30 MINUTE) AS added
        FROM inventory_categories AS c JOIN users AS u ON u.userid = c.owner
        WHERE c.team = :team AND c.state = 1 AND c.owner <> :me2 ORDER BY u.firstname, u.lastname, c.ordering, c.title');
    $req->bindValue(':me', $userId, PDO::PARAM_INT);
    $req->bindValue(':me2', $userId, PDO::PARAM_INT);
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $modules = $req->fetchAll(PDO::FETCH_ASSOC);
    foreach ($modules as &$module) {
        $module['entries'] = (int) $module['added'] === 1 ? $entriesOf((int) $module['id']) : array();
    }
    unset($module);
    respond(200, array('modules' => $modules, 'is_admin' => (bool) $App->Users->isAdmin));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
