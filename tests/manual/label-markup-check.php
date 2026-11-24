<?php

// PHP side of tests/manual/label-markup-check.js: the same cases through web/label-markup.php. Run: php tests/manual/label-markup-check.php
declare(strict_types=1);

require_once __DIR__ . '/../../web/label-markup.php';

use Elabftw\Elabftw\LabelMarkup;

$cases = json_decode((string) file_get_contents(__DIR__ . '/label-markup-cases.json'), true);
$fail = 0;
foreach ($cases as $case) {
    $got = LabelMarkup::parse($case['in']);
    $pieces = array_map(static fn(array $p): array => array($p['text'], ($p['bold'] ? 'b' : '') . ($p['italic'] ? 'i' : ''), $p['scale']), $got['pieces']);
    $ok = json_encode($pieces) === json_encode($case['pieces']) && $got['marked'] === $case['marked'];
    echo ($ok ? 'ok   ' : 'FAIL ') . $case['name'] . ($ok ? '' : ' ' . json_encode(array('got' => $pieces, 'marked' => $got['marked']))) . "\n";
    $fail += $ok ? 0 : 1;
}
foreach (array('', 'a', 'Mix 1/2 (3) {x}', '€ ü \\ ~ ^') as $t) {
    $g = LabelMarkup::parse($t);
    if ($g['marked'] || $g['plain'] !== $t || count($g['pieces']) !== 1) {
        echo 'FAIL untouched ' . json_encode($t) . "\n";
        ++$fail;
    }
}
exit($fail === 0 ? 0 : 1);
