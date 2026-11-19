<?php
/**
 * What's new: shared list + optional extra list (src/whats-new-inventory.json, present on some branches only) and the source modes. No app stack needed:
 *
 *   docker run --rm -v "$PWD":/w -w /w php:8.4-cli php tests/manual/whats-new-split-check.php
 *
 * Works on temporary copies in a temp dir, so it passes on both branches whether or not the real extra file exists.
 * Exit code 0 when all checks pass.
 */
declare(strict_types=1);

namespace Elabftw\Exceptions { class ImproperActionException extends \Exception {} }

namespace {
    require __DIR__ . '/../../src/Services/WhatsNewStore.php';
    require __DIR__ . '/../../src/Services/WhatsNewPopup.php';

    use Elabftw\Services\WhatsNewPopup;
    use Elabftw\Services\WhatsNewStore;

    $fail = 0;
    $check = function (string $name, bool $ok, string $detail = '') use (&$fail): void {
        echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " -- $detail") . "\n";
        $fail += $ok ? 0 : 1;
    };
    $e = fn(string $id, string $date, bool $featured = false, string $title = ''): array => array('id' => $id, 'date' => $date, 'area' => 'x', 'featured' => $featured, 'title' => $title ?: $id, 'summary' => '', 'details' => array(), 'image' => '', 'imageAlt' => '');
    $dir = sys_get_temp_dir() . '/wns-' . bin2hex(random_bytes(4));
    mkdir($dir);
    $write = fn(string $f, mixed $data) => file_put_contents("$dir/$f", is_string($data) ? $data : json_encode($data));
    $ids = fn(array $l): array => array_column($l, 'id');
    $log = ini_get('error_log');
    ini_set('error_log', "$dir/php.log");

    $shared = array($e('s3', '2026-03-03', true), $e('s2', '2026-02-02'), $e('s1', '2026-01-01', true));
    $extra = array($e('x4', '2026-04-04', true), $e('x25', '2026-02-05'), $e('x0', '2025-12-01'), $e('s2', '2026-02-02', false, 'EXTRA COPY OF s2'));
    $write('shared.json', $shared);
    $write('extra.json', $extra);

    // 1. no extra file: same as today (the shared list as is, newest first)
    $st = new WhatsNewStore("$dir/shared.json", "$dir/missing.json");
    $check('no extra file: shared list unchanged', $ids($st->all()) === array('s3', 's2', 's1'), json_encode($ids($st->all())));

    // 2. merge: date desc, unique ids, shared wins
    $st = new WhatsNewStore("$dir/shared.json", "$dir/extra.json");
    $all = $st->all();
    $check('merge order by date, newest first', $ids($all) === array('x4', 's3', 'x25', 's2', 's1', 'x0'), json_encode($ids($all)));
    $check('ids are unique', count($ids($all)) === count(array_unique($ids($all))));
    $s2 = $st->find('s2');
    $check('id in both files: shared wins', $s2 !== null && $s2['title'] === 's2', json_encode($s2));
    $check('find() reaches an extra entry', ($st->find('x0')['id'] ?? '') === 'x0');
    $check('no entry lost: union of the two files', count($all) === count(array_unique(array_merge($ids($shared), $ids($extra)))));

    // 3. same date: shared entry stays before the extra one (stable)
    $write('tie-shared.json', array($e('s9', '2026-05-05')));
    $write('tie-extra.json', array($e('a1', '2026-05-05')));
    $check('same date: shared first, then extra', $ids((new WhatsNewStore("$dir/tie-shared.json", "$dir/tie-extra.json"))->all()) === array('s9', 'a1'));

    // 4. broken / odd extra files are ignored, never an exception
    foreach (array('not json {' => 'broken JSON', '"a string"' => 'JSON string', '{"id":"q"}' => 'object instead of list', '[1,"x",null,{"title":"no id"},{"id":5}]' => 'entries without a string id', '' => 'empty file') as $content => $label) {
        $write('bad.json', (string) $content);
        try {
            $r = (new WhatsNewStore("$dir/shared.json", "$dir/bad.json"))->all();
            $check("extra file ignored: $label", $ids($r) === array('s3', 's2', 's1'), json_encode($ids($r)));
        } catch (\Throwable $t) {
            $check("extra file ignored: $label", false, get_class($t) . ': ' . $t->getMessage());
        }
    }
    mkdir("$dir/adir");
    try {
        $check('extra path is a directory: ignored', $ids((new WhatsNewStore("$dir/shared.json", "$dir/adir"))->all()) === array('s3', 's2', 's1'));
    } catch (\Throwable $t) {
        $check('extra path is a directory: ignored', false, $t->getMessage());
    }
    $check('broken extra file is logged', is_file("$dir/php.log") && str_contains((string) file_get_contents("$dir/php.log"), 'ignoring'));
    $write('bad.json', 'not json');
    $check('broken shared file + good extra: extra entries still listed', $ids((new WhatsNewStore("$dir/nope.json", "$dir/extra.json"))->all()) !== array());

    // 5. the real files of this checkout load and merge cleanly
    $real = new WhatsNewStore(__DIR__ . '/../../src/whats-new.json', __DIR__ . '/../../src/whats-new-inventory.json', 'both');
    $realIds = $ids($real->all());
    $check('real files: ids unique and list not empty', $realIds !== array() && count($realIds) === count(array_unique($realIds)));
    $sharedReal = json_decode((string) file_get_contents(__DIR__ . '/../../src/whats-new.json'), true);
    $check('real files: every shared entry is listed', array_diff($ids($sharedReal), $realIds) === array());

    // 6. unseen logic on the merged list
    $now = strtotime('2026-04-10');
    $u = fn(?array $seen): array => $ids(WhatsNewPopup::unseen($all, $seen, $now));
    // last seen is a shared entry (s2): everything newer, extra or shared, is unseen
    $check('seen = shared s2: newer shared and extra entries are unseen', $u(array('id' => 's2', 'date' => '2026-02-02')) === array('x4', 's3', 'x25'), json_encode($u(array('id' => 's2', 'date' => '2026-02-02'))));
    $check('seen = newest extra x4: nothing unseen', $u(array('id' => 'x4', 'date' => '2026-04-04')) === array());
    $check('seen = oldest shared s1: older extra x0 is not unseen', !in_array('x0', $u(array('id' => 's1', 'date' => '2026-01-01')), true));
    $check('seen = s3 (newer than extra x25): only x4 unseen', $u(array('id' => 's3', 'date' => '2026-03-03')) === array('x4'));
    $check('seen id removed: falls back to its date', $u(array('id' => 'gone', 'date' => '2026-03-01')) === array('x4', 's3'));
    $check('first login: only featured entries of the last 30 days', $u(null) === array('x4'), json_encode($u(null)));
    // the same user on a branch without the extra file: shared-only list, seen id from the extra file is unknown -> date fallback
    $sharedOnly = (new WhatsNewStore("$dir/shared.json", "$dir/missing.json"))->all();
    $r = $ids(WhatsNewPopup::unseen($sharedOnly, array('id' => 'x25', 'date' => '2026-02-05'), $now));
    $check('seen id only on the other branch: date fallback, no error', $r === array('s3'), json_encode($r));

    // 7. popup list rule on 10 extra + shared entries: featured first, 6 max, rest compact (max 8), "N more"
    $many = array();
    for ($i = 1; $i <= 9; $i++) { $many[] = $e("f$i", sprintf('2026-06-%02d', $i), true); }
    for ($i = 1; $i <= 10; $i++) { $many[] = $e("n$i", sprintf('2026-05-%02d', $i)); }
    $write('many-extra.json', $many);
    $merged = (new WhatsNewStore("$dir/shared.json", "$dir/many-extra.json"))->all();
    $unseen = WhatsNewPopup::unseen($merged, array('id' => 's1', 'date' => '2026-01-01'), $now);
    // same selection as WhatsNewPopup::build()
    $featured = array_values(array_filter($unseen, static fn(array $x): bool => !empty($x['featured'])));
    $others = array_values(array_filter($unseen, static fn(array $x): bool => empty($x['featured'])));
    $sf = array_slice($featured, 0, WhatsNewPopup::MAX_FEATURED);
    $sc = array_slice($others, 0, WhatsNewPopup::MAX_COMPACT);
    $more = count($unseen) - count($sf) - count($sc);
    $check('popup: at most 6 featured', count($sf) === 6, (string) count($sf));
    $check('popup: compact list capped at 8', count($sc) === 8, (string) count($sc));
    $check('popup: "N more" counts the rest', $more === count($unseen) - 14 && $more > 0, (string) $more);
    $check('popup: featured entries come from both files, newest first', $ids($sf)[0] === 'f9');

    // 8. source modes (the store takes a mode as its third argument; the extra file of the cases below is a temp copy)
    {
        $m = fn(?string $mode): array => $ids((new WhatsNewStore("$dir/shared.json", "$dir/extra.json", $mode))->all());
        $check('mode both: merged list', $m('both') === array('x4', 's3', 'x25', 's2', 's1', 'x0'), json_encode($m('both')));
        $check('mode orders: shared entries only', $m('orders') === array('s3', 's2', 's1'), json_encode($m('orders')));
        $check('mode inventory: extra file only', $m('inventory') === array('x4', 'x25', 's2', 'x0'), json_encode($m('inventory')));
        $check('unknown mode: treated as both', $m('nonsense') === $m('both'));
        $check('mode inventory without an extra file: shared list', $ids((new WhatsNewStore("$dir/shared.json", "$dir/missing.json", 'inventory'))->all()) === array('s3', 's2', 's1'));
        $check('mode inventory with a broken extra file: shared list', $ids((new WhatsNewStore("$dir/shared.json", "$dir/bad.json", 'inventory'))->all()) === array('s3', 's2', 's1'));
        $check('default (no mode, no env, no setting file value) is both', $ids((new WhatsNewStore("$dir/shared.json", "$dir/extra.json"))->all()) === $m('both'));
        putenv('ELABFTW_WHATS_NEW=orders');
        $check('env ELABFTW_WHATS_NEW=orders is used', $ids((new WhatsNewStore("$dir/shared.json", "$dir/extra.json"))->all()) === array('s3', 's2', 's1'));
        putenv('ELABFTW_WHATS_NEW=inventory');
        $check('env ELABFTW_WHATS_NEW=inventory is used', $ids((new WhatsNewStore("$dir/shared.json", "$dir/extra.json"))->all()) === array('x4', 'x25', 's2', 'x0'));
        putenv('ELABFTW_WHATS_NEW=both');
        $check('env ELABFTW_WHATS_NEW=both is used', $ids((new WhatsNewStore("$dir/shared.json", "$dir/extra.json"))->all()) === $m('both'));
        putenv('ELABFTW_WHATS_NEW');
        // unseen / popup with extras in the modes: a user who saw the newest shared entry gets the extra ones in both, none in orders
        $seen = array('id' => 's3', 'date' => '2026-03-03');
        $check('unseen, mode both: newer extra entry offered', $ids(WhatsNewPopup::unseen((new WhatsNewStore("$dir/shared.json", "$dir/extra.json", 'both'))->all(), $seen, $now)) === array('x4'));
        $check('unseen, mode orders: nothing new', $ids(WhatsNewPopup::unseen((new WhatsNewStore("$dir/shared.json", "$dir/extra.json", 'orders'))->all(), $seen, $now)) === array());

        // the real files of this checkout (the extra file exists on some branches only)
        $realShared = __DIR__ . '/../../src/whats-new.json';
        $realExtra = __DIR__ . '/../../src/whats-new-inventory.json';
        $sharedIds = array_column(json_decode((string) file_get_contents($realShared), true), 'id');
        $check('real files, orders: shared entries only', $ids((new WhatsNewStore($realShared, $realExtra, 'orders'))->all()) === $ids((new WhatsNewStore($realShared, "$dir/missing.json", 'both'))->all()));
        if (is_file($realExtra)) {
            $r = new WhatsNewStore($realShared, $realExtra, 'both');
            $rIds = $ids($r->all());
            $extraIds = array_column(json_decode((string) file_get_contents($realExtra), true), 'id');
            $check('real files, both: ids unique', count($rIds) === count(array_unique($rIds)));
            $check('real files: the extra file holds no id of the shared file', array_intersect($sharedIds, $extraIds) === array(), json_encode(array_values(array_intersect($sharedIds, $extraIds))));
            $check('real files, both = shared + extra', count($rIds) === count($sharedIds) + count($extraIds));
        }
    }

    // clean up
    ini_set('error_log', (string) $log);
    foreach (glob("$dir/*") as $f) { is_dir($f) ? rmdir($f) : unlink($f); }
    rmdir($dir);
    echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
    exit($fail === 0 ? 0 : 1);
}
