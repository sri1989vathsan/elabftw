<?php

/**
 * Check of the Backbone cache (web/backbone.inc.php, table backbone_cache of migration 152): what the finder worked out must come back from the
 * table when the file of the temporary folder is gone (a restart of the container), with the same answer and without reading the sequence files again.
 * Runs inside the web container, against its database (the cache of team 1 is rebuilt, nothing else is changed):
 *   docker exec -i elabftw-inventory-web-1 php -d open_basedir= -d memory_limit=1G < tests/manual/backbone-cache-check.php
 */

declare(strict_types=1);

require '/elabftw/vendor/autoload.php';
require '/elabftw/web/ai-features.inc.php';
require '/elabftw/web/backbone.inc.php';

use Elabftw\Elabftw\Backbone;

$pdo = new PDO('mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4', (string) getenv('DB_USER'), (string) getenv('DB_PASSWORD'), array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC));
$state = static function () use ($pdo): array {
    $finder = new Backbone($pdo, 1);
    $method = new ReflectionMethod($finder, 'state');
    $method->setAccessible(true);
    $t = hrtime(true);
    $result = $method->invoke($finder);
    return array($result[2]['names'], (hrtime(true) - $t) / 1e6);
};
$clear = static function (): void {
    foreach (glob(sys_get_temp_dir() . '/elab-backbone-*-1.ser') ?: array() as $file) {
        unlink($file);
    }
};
$fail = 0;
$check = static function (string $what, bool $ok) use (&$fail): void {
    printf("%s %s\n", $ok ? 'ok  ' : 'FAIL', $what);
    $fail += $ok ? 0 : 1;
};
$pdo->exec('DELETE FROM backbone_cache WHERE team = 1');
$clear();
[$cold, $coldMs] = $state();
$rows = (int) $pdo->query('SELECT COUNT(*) FROM backbone_cache WHERE team = 1')->fetchColumn();
$check('the first run keeps its work in the table (2 rows: words, vocabulary)', $rows === 2);
$clear();
[$after, $afterMs] = $state();
$check('without the file the table gives the same names', $after === $cold);
$check(sprintf('and is quicker than the first run (%.0f ms against %.0f ms)', $afterMs, $coldMs), $afterMs < $coldMs / 2 || $coldMs < 200);
exit($fail === 0 ? 0 : 1);
