<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use PDO;
use Throwable;

/**
 * Who can edit Database entries: for one entry or for a selection. The owner of an entry may change it, and so may an admin of the team.
 * Reading is not touched (everybody with an account can read), but whoever may edit also gets the right to read in the entry's own list, as the permissions of eLabFTW do.
 *
 * POST {action: people}                                              the users and the user groups of the team, to choose from
 * POST {action: current, id}                                        who owns and who can edit one entry now, and whether this person may change it
 * POST {action: set_editors, ids[], users[], teamgroups[], mode, base?}
 *      mode: add (give the listed people the right to edit) | remove (take it away) | replace (only the listed people; the owner stays)
 *      base: owner (10: only the owner) | owner_admins (20) | team (30: all the users of the team); leave out to keep the entry as it is
 */
require_once __DIR__ . '/app/init.inc.php';

function say(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    say(405, array('error' => 'POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    say(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    say(400, array('error' => 'Invalid request.'));
}
$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$me = (int) $App->Users->userData['userid'];
$isAdmin = (bool) $App->Users->isAdmin;
$action = (string) ($payload['action'] ?? '');

try {
    if ($action === 'people') {
        $users = $pdo->prepare('SELECT u.userid AS id, u.firstname, u.lastname FROM users AS u INNER JOIN users2teams AS t ON t.users_id = u.userid AND t.teams_id = :team
            WHERE t.is_archived = 0 AND u.validated = 1 ORDER BY u.firstname, u.lastname');
        $users->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($users);
        $groups = $pdo->prepare('SELECT g.id, g.name, (SELECT COUNT(*) FROM users2team_groups AS m WHERE m.groupid = g.id) AS members FROM team_groups AS g WHERE g.team = :team ORDER BY g.name');
        $groups->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($groups);
        say(200, array(
            'users' => array_map(static fn(array $u): array => array('id' => (int) $u['id'], 'name' => trim($u['firstname'] . ' ' . $u['lastname'])), $users->fetchAll()),
            'groups' => array_map(static fn(array $g): array => array('id' => (int) $g['id'], 'name' => (string) $g['name'], 'members' => (int) $g['members']), $groups->fetchAll()),
        ));
    }

    if ($action === 'current') {
        $one = $pdo->prepare('SELECT i.id, i.userid, i.canwrite, i.canwrite_base, CONCAT(o.firstname, " ", o.lastname) AS owner FROM inventory AS i LEFT JOIN users AS o ON o.userid = i.userid WHERE i.id = :id AND i.team = :team AND i.state = 1');
        $one->bindValue(':id', (int) ($payload['id'] ?? 0), PDO::PARAM_INT);
        $one->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($one);
        $e = $one->fetch();
        if (!is_array($e)) {
            say(404, array('error' => 'Not found.'));
        }
        $cw = json_decode((string) $e['canwrite'], true);
        $names = static function (string $sql, array $ids) use ($pdo): array {
            if ($ids === array()) {
                return array();
            }
            $req = $pdo->prepare($sql . ' (' . implode(',', array_map('intval', $ids)) . ')');
            $pdo->execute($req);
            return $req->fetchAll(PDO::FETCH_ASSOC);
        };
        say(200, array(
            'owner' => trim((string) $e['owner']),
            'owner_id' => (int) $e['userid'],
            'can_change' => (int) $e['userid'] === $me || $isAdmin,
            'base' => (int) $e['canwrite_base'],
            'users' => array_map(static fn(array $u): array => array('id' => (int) $u['id'], 'name' => trim($u['n'])), $names('SELECT userid AS id, CONCAT(firstname, " ", lastname) AS n FROM users WHERE userid IN', (array) ($cw['users'] ?? array()))),
            'teamgroups' => array_map(static fn(array $g): array => array('id' => (int) $g['id'], 'name' => (string) $g['name']), $names('SELECT id, name FROM team_groups WHERE id IN', (array) ($cw['teamgroups'] ?? array()))),
        ));
    }

    if ($action === 'set_editors') {
        $ids = array_values(array_unique(array_filter(array_map('intval', is_array($payload['ids'] ?? null) ? $payload['ids'] : array()), static fn(int $i): bool => $i > 0)));
        if ($ids === array() || count($ids) > 2000) {
            say(400, array('error' => 'Select between 1 and 2000 entries.'));
        }
        $mode = (string) ($payload['mode'] ?? 'add');
        if (!in_array($mode, array('add', 'remove', 'replace'), true)) {
            say(400, array('error' => 'Unknown mode.'));
        }
        // only people and groups of this team
        $pick = static function (string $key, string $sql, string $col) use ($pdo, $teamId, $payload): array {
            $asked = array_values(array_unique(array_filter(array_map('intval', is_array($payload[$key] ?? null) ? $payload[$key] : array()), static fn(int $i): bool => $i > 0)));
            if ($asked === array()) {
                return array();
            }
            $req = $pdo->prepare($sql . ' AND ' . $col . ' IN (' . implode(',', $asked) . ')');
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($req);
            return array_map('intval', $req->fetchAll(PDO::FETCH_COLUMN));
        };
        $users = $pick('users', 'SELECT u.userid AS id FROM users AS u INNER JOIN users2teams AS t ON t.users_id = u.userid WHERE t.teams_id = :team', 't.users_id');
        $groups = $pick('teamgroups', 'SELECT id FROM team_groups WHERE team = :team', 'id');
        $base = null;
        if (isset($payload['base']) && $payload['base'] !== '') {
            $base = array('owner' => 10, 'owner_admins' => 20, 'team' => 30)[(string) $payload['base']] ?? null;
            if ($base === null) {
                say(400, array('error' => 'Unknown base.'));
            }
        }
        if ($users === array() && $groups === array() && $base === null && $mode !== 'replace') {
            say(400, array('error' => 'Choose who can edit.'));
        }
        $read = $pdo->prepare('SELECT id, title, userid, canread, canwrite, canread_base, canwrite_base FROM inventory WHERE team = :team AND state = 1 AND id IN (' . implode(',', $ids) . ')');
        $read->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($read);
        $found = $read->fetchAll();
        $write = $pdo->prepare('UPDATE inventory SET canread = :canread, canwrite = :canwrite, canread_base = :canread_base, canwrite_base = :canwrite_base WHERE id = :id');
        $changed = 0;
        $same = 0;
        $skipped = array();
        $norm = static function (mixed $json): array {
            $p = is_string($json) ? (json_decode($json, true) ?? array()) : array();
            $out = array();
            foreach (array('teams', 'teamgroups', 'users') as $k) {
                $out[$k] = array_values(array_unique(array_map('intval', (array) ($p[$k] ?? array()))));
            }
            return $out;
        };
        foreach ($found as $e) {
            if ((int) $e['userid'] !== $me && !$isAdmin) {
                $skipped[] = array('id' => (int) $e['id'], 'title' => (string) $e['title'], 'why' => 'Only the owner or an admin can change this.');
                continue;
            }
            $cw = $norm($e['canwrite']);
            $cr = $norm($e['canread']);
            $before = json_encode(array($cw, $cr, (int) $e['canwrite_base'], (int) $e['canread_base']));
            if ($mode === 'replace') {
                $cw['users'] = $users;
                $cw['teamgroups'] = $groups;
            } elseif ($mode === 'add') {
                $cw['users'] = array_values(array_unique(array_merge($cw['users'], $users)));
                $cw['teamgroups'] = array_values(array_unique(array_merge($cw['teamgroups'], $groups)));
            } else {
                $cw['users'] = array_values(array_diff($cw['users'], $users));
                $cw['teamgroups'] = array_values(array_diff($cw['teamgroups'], $groups));
            }
            // whoever may edit may read
            $cr['users'] = array_values(array_unique(array_merge($cr['users'], $cw['users'])));
            $cr['teamgroups'] = array_values(array_unique(array_merge($cr['teamgroups'], $cw['teamgroups'])));
            $wb = $base ?? (int) $e['canwrite_base'];
            $rb = max((int) $e['canread_base'], $wb);
            if (json_encode(array($cw, $cr, $wb, $rb)) === $before) {
                $same++;
                continue;
            }
            $write->bindValue(':canread', json_encode($cr));
            $write->bindValue(':canwrite', json_encode($cw));
            $write->bindValue(':canread_base', $rb, PDO::PARAM_INT);
            $write->bindValue(':canwrite_base', $wb, PDO::PARAM_INT);
            $write->bindValue(':id', (int) $e['id'], PDO::PARAM_INT);
            $pdo->execute($write);
            $changed++;
        }
        say(200, array('changed' => $changed, 'unchanged' => $same, 'skipped' => $skipped, 'not_found' => count($ids) - count($found)));
    }

    say(400, array('error' => 'Unknown action.'));
} catch (Throwable $e) {
    say(500, array('error' => 'This failed.', 'message' => $e->getMessage()));
}
