<?php
// A stored What's new entry that still names a picture the code now ships as a PNG must still find it.
// Run inside the web container:  docker exec -i <web> php < tests/manual/whats-new-image-fallback-check.php
require '/elabftw/vendor/autoload.php';

$store = new Elabftw\Services\WhatsNewStore();
$fail = 0;
$check = static function (string $label, bool $ok) use (&$fail): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $label . PHP_EOL;
    if (!$ok) {
        $fail++;
    }
};
$jpg = $store->imagePath('orders.jpg');
$check('an old .jpg name finds the shipped PNG', $jpg !== null && str_ends_with($jpg, 'orders.png'));
$png = $store->imagePath('orders.png');
$check('the .png name still resolves', $png !== null && str_ends_with($png, 'orders.png'));
$check('an unknown .jpg stays null', $store->imagePath('no-such-picture-xyz.jpg') === null);
$check('an unsafe name stays null', $store->imagePath('../etc.jpg') === null);
echo $fail === 0 ? 'ALL PASSED' . PHP_EOL : $fail . ' FAILED' . PHP_EOL;
exit($fail === 0 ? 0 : 1);
