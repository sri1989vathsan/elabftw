<?php
/**
 * tex2svg-skip: a text without math delimiters is not sent to the node app (no "problem during PDF creation" notice when the bundle is missing).
 *
 *   docker exec -i <web> php -r 'require "/elabftw/vendor/autoload.php"; eval("?>".$argv[1]); eval("?>".stream_get_contents(STDIN));' -- "$(sed '/^declare(strict_types/d' src/Services/Tex2Svg.php)" < tests/manual/tex2svg-skip-check.php
 *
 * The Mpdf and logger are never used for a text without math, so stand-ins are enough.
 */
use Elabftw\Services\Tex2Svg;

$log = new class extends \Psr\Log\AbstractLogger {
    public int $warnings = 0;
    public function log($level, string|\Stringable $message, array $context = array()): void { $this->warnings++; }
};
$mpdf = (new ReflectionClass(\Mpdf\Mpdf::class))->newInstanceWithoutConstructor();
$failed = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$failed): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : ' -- ' . $detail) . "\n";
    $ok || $failed++;
};
$html = '<h2>Plasmids</h2><table><tr><td>pUC19</td></tr></table>';
$t = new Tex2Svg($log, $mpdf, $html);
$check('no math: the text is returned unchanged', $t->getContent() === $html, 'changed');
$check('no math: nothing failed, nothing logged', $t->mathJaxFailed === false && $log->warnings === 0, 'failed/logged');
echo $failed === 0 ? "ALL PASSED\n" : "$failed FAILED\n";
exit($failed === 0 ? 0 : 1);
