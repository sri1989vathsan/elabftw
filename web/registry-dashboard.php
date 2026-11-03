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
use Elabftw\Exceptions\AppException;
use Exception;
use PDO;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

use function array_filter;
use function array_slice;
use function count;
use function date;
use function header;
use function http_response_code;
use function is_array;
use function json_decode;
use function json_encode;
use function preg_match;
use function strtotime;
use function usort;

/**
 * The dashboard of the Database: how much there is, in which modules, and what needs attention (stock that expires, entries that are
 * stored nowhere, boxes that are almost full, entries that are not in the lab Database yet, entries that miss something).
 *
 * GET gives the page; GET ?data=1 gives the numbers as JSON.
 */
require_once __DIR__ . '/app/init.inc.php';

if (!isset($_GET['data'])) {
    $Response = new Response();
    try {
        $Response->prepare($App->Request);
        $Response->setContent($App->render('registry-dashboard.html', array('pageTitle' => _('Dashboard'), 'hideTitle' => true)));
        $Response->headers->set('Cache-Control', 'no-store');
    } catch (AppException $e) {
        $Response = $e->getResponseFromException($App);
    } catch (Exception $e) {
        $Response = $App->getResponseFromException($e);
    } finally {
        $Response->send();
    }
    exit;
}

header('Content-Type: application/json; charset=utf-8');
$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$userId = (int) $App->Users->userData['userid'];
$canRead = new CanSqlBuilder($App->Users, AccessType::Read)->getCanFilter();
$LIMIT = 15;

try {
    // the entries of the lab Database that this user can read
    $labWhere = 'entity.state = 1 AND entity.team = :team AND entity.is_planned = 0 AND entity.custom_id IS NOT NULL' . $canRead;
    $run = static function (string $sql, array $binds = array()) use ($pdo, $teamId, $userId) {
        $req = $pdo->prepare($sql);
        foreach (array('team' => $teamId, 'userid' => $userId) + $binds as $key => $value) {
            if (str_contains($sql, ':' . $key)) {
                $req->bindValue(':' . $key, $value, PDO::PARAM_INT);
            }
        }
        $pdo->execute($req);
        return $req;
    };

    $total = (int) $run('SELECT COUNT(*) FROM inventory AS entity WHERE ' . $labWhere)->fetchColumn();
    $recent = (int) $run('SELECT COUNT(*) FROM inventory AS entity WHERE ' . $labWhere . ' AND entity.created_at > NOW() - INTERVAL 7 DAY')->fetchColumn();
    $active = (int) $run('SELECT COUNT(DISTINCT c.users_id) FROM inventory_changelog AS c INNER JOIN inventory AS entity ON entity.id = c.entity_id WHERE entity.team = :team AND c.created_at > NOW() - INTERVAL 30 DAY')->fetchColumn();
    $mineTotal = (int) $run('SELECT COUNT(*) FROM inventory AS entity WHERE ' . $labWhere . ' AND entity.userid = :userid')->fetchColumn();
    $modules = $run('SELECT c.id, c.title, c.color, c.settings, (SELECT COUNT(*) FROM inventory AS entity WHERE entity.category = c.id AND ' . $labWhere . ') AS n, (SELECT COUNT(*) FROM inventory AS entity WHERE entity.category = c.id AND entity.userid = :userid AND ' . $labWhere . ') AS mine
        FROM inventory_categories AS c WHERE c.team = :team AND c.state = 1 ORDER BY c.ordering, c.title')->fetchAll();
    $byModule = array();
    $needsSequence = array();
    foreach ($modules as $module) {
        $byModule[] = array('id' => (int) $module['id'], 'title' => (string) $module['title'], 'color' => (string) $module['color'], 'count' => (int) $module['n'], 'mine' => (int) $module['mine']);
        $settings = json_decode((string) $module['settings'], true);
        if (is_array($settings) && !empty($settings['requires_sequence_file'])) {
            $needsSequence[] = (int) $module['id'];
        }
    }
    $moduleTitles = array();
    foreach ($modules as $module) {
        $moduleTitles[(int) $module['id']] = (string) $module['title'];
    }

    $risks = array();
    $entryItem = static fn(array $row, string $detail = ''): array => array('id' => (int) $row['id'], 'title' => (string) $row['title'], 'module' => $moduleTitles[(int) ($row['category'] ?? 0)] ?? '', 'detail' => $detail, 'mine' => (int) ($row['userid'] ?? 0) === $userId, 'owner' => trim((string) ($row['owner'] ?? '')));
    // a check: how many in all, how many are the user's, and the entries (the user's first)
    $risk = static function (string $key, string $label, array $items) use ($LIMIT): array {
        $mine = count(array_filter($items, static fn(array $i): bool => $i['mine'] === true));
        usort($items, static fn(array $a, array $b): int => (int) $b['mine'] <=> (int) $a['mine']);
        return array('key' => $key, 'label' => $label, 'count' => count($items), 'mine' => $mine, 'items' => array_slice($items, 0, $LIMIT));
    };
    $OWNER = ', entity.userid, (SELECT CONCAT(o.firstname, " ", o.lastname) FROM users AS o WHERE o.userid = entity.userid) AS owner';

    // stock that expires: a date field with "expir" in its name, in the past or in the next 30 days
    $today = strtotime(date('Y-m-d'));
    $expired = array();
    $expiring = array();
    foreach ($run('SELECT entity.id, entity.title, entity.category, entity.metadata' . $OWNER . ' FROM inventory AS entity WHERE ' . $labWhere . " AND entity.metadata LIKE '%xpir%'")->fetchAll() as $row) {
        $metadata = json_decode((string) $row['metadata'], true);
        foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
            if (!is_array($field) || preg_match('/expir/i', (string) $name) !== 1 || trim((string) ($field['value'] ?? '')) === '') {
                continue;
            }
            $when = strtotime((string) $field['value']);
            if ($when === false) {
                continue;
            }
            if ($when < $today) {
                $expired[] = $entryItem($row, 'expired ' . $field['value']);
            } elseif ($when <= $today + 30 * 86400) {
                $expiring[] = $entryItem($row, 'expires ' . $field['value']);
            }
            break;
        }
    }
    usort($expiring, static fn(array $a, array $b): int => strcmp($a['detail'], $b['detail']));
    $risks[] = $risk('expiring', 'Expiring in 30 days', $expiring);
    $risks[] = $risk('expired', 'Expired', $expired);

    // entries stored nowhere
    $unstored = $run('SELECT entity.id, entity.title, entity.category' . $OWNER . ' FROM inventory AS entity WHERE ' . $labWhere . ' AND NOT EXISTS (SELECT 1 FROM containers2inventory AS k WHERE k.item_id = entity.id) ORDER BY entity.id DESC')->fetchAll();
    $risks[] = $risk('unstored', 'Not stored anywhere', array_map($entryItem, $unstored));

    // boxes that are almost full
    $units = $run('SELECT id, name, parent_id, box_rows, box_cols FROM storage_units')->fetchAll();
    $byId = array();
    foreach ($units as $unit) {
        $byId[(int) $unit['id']] = $unit;
    }
    $pathOf = static function (int $id) use (&$byId): string {
        $parts = array();
        $guard = 0;
        while ($id > 0 && isset($byId[$id]) && $guard++ < 12) {
            array_unshift($parts, (string) $byId[$id]['name']);
            $id = (int) ($byId[$id]['parent_id'] ?? 0);
        }
        return implode(' > ', $parts);
    };
    $used = array();
    foreach ($run("SELECT storage_id, COUNT(DISTINCT position) AS n FROM containers2inventory WHERE position IS NOT NULL AND position <> '' GROUP BY storage_id")->fetchAll() as $row) {
        $used[(int) $row['storage_id']] = (int) $row['n'];
    }
    $full = array();
    foreach ($units as $unit) {
        $slots = (int) $unit['box_rows'] * (int) $unit['box_cols'];
        if ($slots > 0 && ($used[(int) $unit['id']] ?? 0) / $slots >= 0.85) {
            $full[] = array('id' => (int) $unit['id'], 'title' => $pathOf((int) $unit['id']), 'module' => '', 'detail' => ($used[(int) $unit['id']] ?? 0) . ' of ' . $slots . ' slots used', 'storage' => true);
        }
    }
    $risks[] = array('key' => 'full', 'label' => 'Boxes almost full', 'count' => count($full), 'mine' => null, 'items' => array_slice($full, 0, $LIMIT));

    // the entries of this user that are not in the lab Database yet
    $waiting = $run('SELECT entity.id, entity.title, entity.category' . $OWNER . ' FROM inventory AS entity WHERE entity.state = 1 AND entity.team = :team AND entity.userid = :userid AND (entity.is_planned = 1 OR entity.custom_id IS NULL) ORDER BY entity.id DESC')->fetchAll();
    $risks[] = $risk('waiting', 'Yours, not in the lab Database yet', array_map($entryItem, $waiting));

    // entries that miss what their module asks: a required field, or a sequence file
    $incomplete = array();
    foreach ($run('SELECT entity.id, entity.title, entity.category, entity.metadata' . $OWNER . ' FROM inventory AS entity WHERE ' . $labWhere . " AND entity.metadata LIKE '%required%'")->fetchAll() as $row) {
        $metadata = json_decode((string) $row['metadata'], true);
        $missing = array();
        foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
            if (is_array($field) && !empty($field['required']) && trim((string) ($field['value'] ?? '')) === '') {
                $missing[] = (string) $name;
            }
        }
        if ($missing !== array()) {
            $incomplete[(int) $row['id']] = $entryItem($row, 'needs ' . implode(', ', array_slice($missing, 0, 3)));
        }
    }
    if ($needsSequence !== array()) {
        $likes = "(LOWER(u.real_name) LIKE '%.gb' OR LOWER(u.real_name) LIKE '%.gbk' OR LOWER(u.real_name) LIKE '%.gbff' OR LOWER(u.real_name) LIKE '%.genbank' OR LOWER(u.real_name) LIKE '%.fasta' OR LOWER(u.real_name) LIKE '%.fa' OR LOWER(u.real_name) LIKE '%.fna' OR LOWER(u.real_name) LIKE '%.dna')";
        foreach ($run('SELECT entity.id, entity.title, entity.category' . $OWNER . ' FROM inventory AS entity WHERE ' . $labWhere . ' AND entity.category IN (' . implode(',', $needsSequence) . ") AND NOT EXISTS (SELECT 1 FROM uploads AS u WHERE u.item_id = entity.id AND u.type = 'inventory' AND u.state = 1 AND " . $likes . ')')->fetchAll() as $row) {
            $incomplete[(int) $row['id']] = $entryItem($row, 'no sequence file');
        }
    }
    $risks[] = $risk('incomplete', 'Missing what the module needs', array_values($incomplete));

    echo json_encode(array('total' => $total, 'mineTotal' => $mineTotal, 'modules' => count($modules), 'recent' => $recent, 'active' => $active, 'byModule' => $byModule, 'risks' => $risks, 'updated' => date('H:i:s')));
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(array('error' => $e->getMessage()));
}
