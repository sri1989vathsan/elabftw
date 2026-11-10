<?php

/**
 * Look at the personal modules of one person, read only. Fork-only file.
 *
 * Personal modules are private by default and do not appear in the lists of the Database. Anyone of the team can look at the personal modules of
 * one person at a time, on purpose, with this file; every look is logged and the owner sees it in "My modules...". Admins can also change them
 * (registry-my-modules.php) and open the entries.
 *
 * GET                 gives the people of the team who have personal modules (with their numbers of modules and entries).
 * GET ?user=ID        gives the personal modules of that person with their entries, and logs the look.
 */
declare(strict_types=1);

namespace Elabftw\Elabftw;

use PDO;
use Throwable;

use function header;
use function http_response_code;
use function json_encode;

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
    $user = (int) ($_GET['user'] ?? 0);
    if ($user === 0) {
        $req = $pdo->prepare('SELECT u.userid, CONCAT(u.firstname, " ", u.lastname) AS name, COUNT(DISTINCT c.id) AS modules,
                (SELECT COUNT(*) FROM inventory AS i JOIN inventory_categories AS c2 ON c2.id = i.category WHERE c2.owner = u.userid AND i.state = 1) AS entries
            FROM inventory_categories AS c JOIN users AS u ON u.userid = c.owner
            WHERE c.team = :team AND c.state = 1 AND c.owner <> :me GROUP BY u.userid, u.firstname, u.lastname ORDER BY u.firstname, u.lastname');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':me', $userId, PDO::PARAM_INT);
        $pdo->execute($req);
        respond(200, array('people' => $req->fetchAll(PDO::FETCH_ASSOC)));
    }
    $mods = $pdo->prepare('SELECT c.id, c.title, c.color FROM inventory_categories AS c WHERE c.team = :team AND c.state = 1 AND c.owner = :owner ORDER BY c.ordering, c.title');
    $mods->bindValue(':team', $teamId, PDO::PARAM_INT);
    $mods->bindValue(':owner', $user, PDO::PARAM_INT);
    $pdo->execute($mods);
    $modules = $mods->fetchAll(PDO::FETCH_ASSOC);
    $entries = $pdo->prepare('SELECT id, title, personal_id, state FROM inventory WHERE category = :id AND state IN (1, 2) ORDER BY title LIMIT 500');
    foreach ($modules as &$module) {
        $entries->bindValue(':id', (int) $module['id'], PDO::PARAM_INT);
        $pdo->execute($entries);
        $module['entries'] = $entries->fetchAll(PDO::FETCH_ASSOC);
    }
    unset($module);
    // logged, but not again for the same pair within ten minutes
    if ($user !== $userId) {
        $log = $pdo->prepare('INSERT INTO personal_module_views (viewer, owner)
            SELECT :viewer, :owner FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM personal_module_views WHERE viewer = :viewer2 AND owner = :owner2 AND viewed_at > NOW() - INTERVAL 10 MINUTE)');
        $log->bindValue(':viewer', $userId, PDO::PARAM_INT);
        $log->bindValue(':owner', $user, PDO::PARAM_INT);
        $log->bindValue(':viewer2', $userId, PDO::PARAM_INT);
        $log->bindValue(':owner2', $user, PDO::PARAM_INT);
        $pdo->execute($log);
    }
    respond(200, array('modules' => $modules, 'is_admin' => (bool) $App->Users->isAdmin));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage()));
}
