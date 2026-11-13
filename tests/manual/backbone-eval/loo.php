<?php
// Leave-one-out test of web/backbone.inc.php on the plasmids that already have a Backbone: each one is looked up as if it were new
// (itself left out of the references). Run inside the web container: php loo.php [team]
declare(strict_types=1);
namespace Elabftw\Elabftw;
require '/elabftw/web/ai-features.inc.php';
require getenv('BB_INC') ?: '/elabftw/web/backbone.inc.php';
$pdo = new \PDO('mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4', getenv('DB_USER'), getenv('DB_PASSWORD'), array(\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC));
$team = (int) ($argv[1] ?? 1);
$finder = new Backbone($pdo, $team);
$dir = '/var/lib/elabftw/uploads';
$req = $pdo->query("SELECT i.id, i.title, i.metadata, MIN(u.long_name) AS file FROM inventory i JOIN inventory_categories c ON c.id=i.category AND c.title='Plasmids' JOIN uploads u ON u.item_id=i.id AND u.type='inventory' AND u.state=1 AND (u.real_name LIKE '%.gb' OR u.real_name LIKE '%.gbk' OR u.real_name LIKE '%.ape') WHERE i.team=$team AND i.state=1 GROUP BY i.id, i.title, i.metadata");
$rows = array();
$t0 = microtime(true);
foreach ($req->fetchAll() as $r) {
    $m = json_decode($r['metadata'], true);
    $want = trim((string) ($m['extra_fields']['Backbone']['value'] ?? ''));
    if ($want === '' || !is_file("$dir/{$r['file']}")) { continue; }
    $res = $finder->find(aiGenBankSequence(file_get_contents("$dir/{$r['file']}")), (int) $r['id']);
    $rows[] = array('id' => $r['id'], 'title' => $r['title'], 'want' => $want, 'got' => $res['backbone'], 'top' => $res['chosen'] ?? '', 'cover' => $res['score'], 'lead' => $res['lead']);
}
printf("%d plasmids with a backbone and a file, %.1f s\n", count($rows), microtime(true) - $t0);
$n = count($rows);
// right = the same name; kin = the same name or one name starts with the other (pT4 / pT4-U6-sgRNA-CMV-EGFP), the lab's names are nested
$same = static fn($a, $b) => $a === $b;
$kin = static fn($a, $b) => $a === $b || str_starts_with($a, $b) || str_starts_with($b, $a);
foreach (array(1.0, 1.3, 2.0) as $lead) {
    foreach (array(0.0, 0.2, 0.3, 0.4, 0.5) as $t) {
        $named = $right = $near = 0;
        foreach ($rows as $r) {
            if ($r['top'] !== '' && $r['cover'] >= $t && $r['lead'] >= $lead) { $named++; $right += $same($r['top'], $r['want']) ? 1 : 0; $near += $kin($r['top'], $r['want']) ? 1 : 0; }
        }
        printf("lead >= %.1f, score >= %.1f: named %3d/%d = %4.1f%%; same name %4.1f%%, same or nested name %4.1f%%\n", $lead, $t, $named, $n, 100 * $named / $n, $named ? 100 * $right / $named : 0, $named ? 100 * $near / $named : 0);
    }
}
$wrong = array_filter($rows, fn($r) => $r['got'] !== '' && !$kin($r['got'], $r['want']));
printf("--- wrong at the default thresholds (not even a nested name): %d. id | title | recorded | found | score | lead\n", count($wrong));
foreach (array_slice($wrong, 0, 30) as $r) { printf("%s | %s | %s | %s | %.2f | %.1f\n", $r['id'], mb_substr($r['title'], 0, 30), $r['want'], $r['got'], $r['cover'], $r['lead']); }
file_put_contents('/run/elabftw/cache/loo.json', json_encode($rows));
