<?php
/**
 * What's new, inventory branch only: the real src/whats-new-inventory.json still holds everything of the old inventory guide.
 * (The shared checks are in whats-new-split-check.php, identical on both branches.)
 *
 *   docker run --rm -v "$PWD":/w -w /w php:8.4-cli php tests/manual/whats-new-inventory-check.php
 */
declare(strict_types=1);

namespace Elabftw\Exceptions { class ImproperActionException extends \Exception {} }

namespace {
    require __DIR__ . '/../../src/Services/WhatsNewStore.php';

    use Elabftw\Services\WhatsNewStore;

    $fail = 0;
    $check = function (string $name, bool $ok, string $detail = '') use (&$fail): void {
        echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " -- $detail") . "\n";
        $fail += $ok ? 0 : 1;
    };
    $ids = fn(array $l): array => array_column($l, 'id');
    $shared = __DIR__ . '/../../src/whats-new.json';
    $extra = __DIR__ . '/../../src/whats-new-inventory.json';
    $old = array(
        'database-guide',
        'folder-path-bar',
        'plate-view-and-copy',
        'link-to-data',
        'quick-links',
        'link-templates-and-versions',
        'spreadsheet-previews',
        'list-indent',
        'template-version-history',
        'spreadsheet-insert-and-view',
        'boards',
        'orders',
        'spreadsheet-editing',
        'navigation',
        'cards-linked-experiments',
        'notifications-feedback',
        'activity-calendar',
        'left-sidebar',
        'guide-folders',
        'guide-folder-views',
        'guide-database',
        'guide-database-storage',
        'guide-sequence-editor',
        'guide-lineage',
        'guide-database-sharing',
        'guide-sidebar',
        'guide-calendar',
        'guide-boards',
        'guide-orders',
        'guide-experiment-sections',
        'guide-steps',
        'guide-templates',
        'guide-feedback',
        'guide-search-filters',
        'guide-toc',
        'guide-todo-notifications',
        'guide-editor-toolbar',
        'guide-spreadsheets',
        'guide-collaboration',
        'guide-todo',
        'guide-announcements',
        'guide-experiments',
        'guide-resources'
    );
    $check('the extra file exists', is_file($extra));
    $rIds = $ids((new WhatsNewStore($shared, $extra, 'both'))->all());
    $check('mode both: all ' . count($old) . ' ids of the old inventory guide are present', array_diff($old, $rIds) === array(), json_encode(array_values(array_diff($old, $rIds))));
    $check('mode inventory: the extra file alone, no id of the shared file', array_intersect($ids((new WhatsNewStore($shared, $extra, 'inventory'))->all()), array_column(json_decode((string) file_get_contents($shared), true), 'id')) === array());
    echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
    exit($fail === 0 ? 0 : 1);
}
