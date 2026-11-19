<?php

/**
 * Helper of inventory-twin-tables-check.sh: runs the real CustomMigrationRunner against the database given by the DB_* environment variables.
 *   php inventory-twin-tables-runner.php old   -> only the migrations that existed before the twin tables were spelled out (the 'upgraded' history)
 *   php inventory-twin-tables-runner.php full  -> everything, as `bin/console custom:db:update` does
 * Prints "applied N" and the names of the migrations that the runner recorded without running them.
 */

declare(strict_types=1);

require '/elabftw/vendor/autoload.php';

use Elabftw\Elabftw\CustomMigrationRunner;
use Elabftw\Elabftw\Db;
use Elabftw\Elabftw\SchemaVersionChecker;
use League\Flysystem\Filesystem;
use League\Flysystem\Local\LocalFilesystemAdapter;

$fs = new Filesystem(new LocalFilesystemAdapter('/elabftw/src/sql/custom'));
$all = CustomMigrationRunner::all();
$list = ($argv[1] ?? 'full') === 'old' ? array_values(array_filter($all, static fn(string $m): bool => !str_contains($m, '_twin_'))) : $all;
$Db = Db::getConnection();
$before = $Db->q("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_schema_migrations'")->fetchColumn() ? $Db->q('SELECT COUNT(*) FROM custom_schema_migrations')->fetchColumn() : 0;
$runner = new CustomMigrationRunner(SchemaVersionChecker::REQUIRED_SCHEMA, $fs, null, $list);
$applied = $runner->migrate();
$after = (int) $Db->q('SELECT COUNT(*) FROM custom_schema_migrations')->fetchColumn();
printf("applied %d, ledger %d -> %d\n", $applied, (int) $before, $after);
