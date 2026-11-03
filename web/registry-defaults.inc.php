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

use PDO;

use function file_get_contents;
use function header;
use function is_array;
use function json_decode;
use function json_encode;

/**
 * The modules a team of the database starts with, defined in default-modules.json (plasmids, antibodies, cells and strains, probes, primers,
 * reagents, samples, each with its fields and the columns of its list). A team that has no module at all gets them the first time its
 * Database is opened; a team that has modules is never changed. Admins can rename, change or delete them afterwards.
 *
 * @return bool true when the modules were just made
 */
function seedDefaultModules(int $teamId): bool
{
    $pdo = Db::getConnection();
    $count = $pdo->prepare('SELECT COUNT(*) FROM inventory_categories WHERE team = :team');
    $count->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($count);
    if ((int) $count->fetchColumn() > 0) {
        return false;
    }
    $definition = json_decode((string) file_get_contents(__DIR__ . '/default-modules.json'), true);
    if (!is_array($definition) || !is_array($definition['modules'] ?? null)) {
        return false;
    }
    $insert = $pdo->prepare('INSERT INTO inventory_categories (team, title, color, is_private, ordering, state, fields, settings) VALUES (:team, :title, :color, 0, :ordering, 1, :fields, :settings)');
    foreach ($definition['modules'] as $module) {
        $insert->bindValue(':team', $teamId, PDO::PARAM_INT);
        $insert->bindValue(':title', (string) $module['title']);
        $insert->bindValue(':color', (string) $module['color']);
        $insert->bindValue(':ordering', (int) ($module['ordering'] ?? 0), PDO::PARAM_INT);
        $insert->bindValue(':fields', json_encode($module['fields'], JSON_UNESCAPED_UNICODE));
        $insert->bindValue(':settings', json_encode($module['settings'], JSON_UNESCAPED_UNICODE));
        $pdo->execute($insert);
    }
    return true;
}

/**
 * The pages of the database make the default modules of a team that has none, then load again to show them
 */
function seedDefaultModulesAndReload(App $App): void
{
    if ($App->isAnonymous() || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        return;
    }
    if (seedDefaultModules((int) $App->Users->userData['team'])) {
        header('Location: ' . ($_SERVER['REQUEST_URI'] ?? '/registry.php'));
        exit;
    }
}
