<?php

/**
 * Checks of web/link-page.php (no network, no database). On the host there is no PHP: run it with the image,
 *   docker run --rm -v "$PWD":/w:ro --entrypoint php84 elabftw/elabimg:inventory /w/tests/manual/link-page-check.php
 */

declare(strict_types=1);

define('LINK_PAGE_AS_LIBRARY', true);
require __DIR__ . '/../../web/link-page.php';

$failures = 0;
$check = static function (string $name, bool $ok, mixed $detail = null) use (&$failures): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : ' ' . json_encode($detail)) . "\n";
    $failures += $ok ? 0 : 1;
};

// what a link may not be: a way into the network of the lab or the machine itself
foreach (array(
    'http://127.0.0.1/', 'http://localhost/', 'http://10.1.2.3/x', 'http://192.168.0.5/', 'http://172.16.0.9/', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'http://0.0.0.0/', 'ftp://example.com/', 'file:///etc/passwd', 'http://user:pass@93.184.216.34/', 'http://93.184.216.34:8080/', 'javascript:alert(1)', 'not a url',
) as $bad) {
    $check('refused: ' . $bad, Elabftw\Elabftw\safeTarget($bad) === null, Elabftw\Elabftw\safeTarget($bad));
}
$good = Elabftw\Elabftw\safeTarget('https://93.184.216.34/page');
$check('a public address is accepted, https on port 443', is_array($good) && $good['port'] === 443 && $good['ips'] === array('93.184.216.34'), $good);
$check('http gets port 80', (Elabftw\Elabftw\safeTarget('http://93.184.216.34/')['port'] ?? 0) === 80);

$html = '<html><head><title>Anti-Nestin antibody | Vendor</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Anti-Nestin antibody [SP103]","sku":"ab105389","brand":{"@type":"Brand","name":"Abcam"},"description":"Rabbit monoclonal"}</script><style>.x{}</style></head>'
    . '<body><h1>Anti-Nestin antibody</h1><script>var a=1;</script><table><tr><th>Host species</th><td>Rabbit</td></tr><tr><th>Clone number</th><td>SP103</td></tr></table>'
    . '<dl><dt>Isotype</dt><dd>IgG</dd></dl><ul><li>Reacts with</li><li>Mouse, Rat, Human</li></ul></body></html>';
$read = Elabftw\Elabftw\pageText($html);
$check('the title is kept', $read['title'] === 'Anti-Nestin antibody | Vendor', $read['title']);
$check('the data of the product come first', str_starts_with($read['text'], 'Product name Anti-Nestin antibody [SP103]'), substr($read['text'], 0, 80));
$check('catalog number and supplier of the product are lines', str_contains($read['text'], "Catalog number ab105389\n") && str_contains($read['text'], 'Supplier Abcam'), $read['text']);
$check('a label and its value of a table stay on one line', str_contains($read['text'], "Host species Rabbit\n") && str_contains($read['text'], "Clone number SP103\n"), $read['text']);
$check('scripts and styles are not in the text', !str_contains($read['text'], 'var a=1') && !str_contains($read['text'], '.x{}'), $read['text']);
$check('a label alone on a line has its value on the next', str_contains($read['text'], "Isotype\nIgG"), $read['text']);

echo $failures === 0 ? "all passed\n" : $failures . " failed\n";
exit($failures === 0 ? 0 : 1);
