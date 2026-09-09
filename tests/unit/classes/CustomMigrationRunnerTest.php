<?php

declare(strict_types=1);
/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\ImproperActionException;
use League\Flysystem\Filesystem as Fs;
use League\Flysystem\InMemory\InMemoryFilesystemAdapter;

use function sprintf;
use function uniqid;

/**
 * Covers the cross-branch scenario described in ELABFTW-CUSTOMIZATIONS.md:
 * usability and orders assign different filenames to a handful of otherwise
 * identical migrations, so a database moving between the two branches must
 * not silently re-run the same schema change under the new filename.
 */
class CustomMigrationRunnerTest extends \PHPUnit\Framework\TestCase
{
    private Fs $Fs;

    private Db $Db;

    private string $table;

    /** unique per test run (not just per test file/table) -- migration
     * filenames land in the same shared custom_schema_migrations table
     * every other test run/worker uses, so a fixed name would collide if
     * tests ever run in parallel or a previous run's teardown was skipped
     * (e.g. the process was killed mid-test) */
    private string $prefix;

    protected function setUp(): void
    {
        $this->Fs = new Fs(new InMemoryFilesystemAdapter());
        $this->Db = Db::getConnection();
        $unique = uniqid();
        $this->table = 'test_migration_runner_' . $unique;
        $this->prefix = 'zzz_test_' . $unique . '_';
    }

    protected function tearDown(): void
    {
        $this->Db->q(sprintf('DROP TABLE IF EXISTS `%s`', $this->table));
        $this->Db->q(sprintf("DELETE FROM custom_schema_migrations WHERE migration LIKE '%s%%'", $this->prefix));
    }

    private function runner(array $migrations): CustomMigrationRunner
    {
        return new CustomMigrationRunner(SchemaVersionChecker::REQUIRED_SCHEMA, $this->Fs, null, $migrations);
    }

    private function filename(string $letter): string
    {
        return $this->prefix . $letter . '.sql';
    }

    private function createTableSql(): string
    {
        // no IF NOT EXISTS on purpose -- this errors if run a second time,
        // which is exactly what proves a checksum-matched migration under a
        // different filename was recorded rather than actually re-executed
        return sprintf('CREATE TABLE `%s` (id INT)', $this->table);
    }

    /** 1. Apply a migration under filename A. */
    public function testAppliesNewMigration(): void
    {
        $a = $this->filename('a');
        $this->Fs->write($a, $this->createTableSql());
        $applied = $this->runner(array($a))->migrate();

        $this->assertSame(1, $applied);
        $req = $this->Db->q(sprintf("SELECT checksum FROM custom_schema_migrations WHERE migration = '%s'", $a));
        $this->assertNotFalse($req->fetch());
    }

    /**
     * 2. Present identical SQL under filename B.
     * 3. Confirm B is recorded without executing the SQL again.
     */
    public function testIdenticalContentUnderAnotherFilenameIsRecordedWithoutReexecution(): void
    {
        $a = $this->filename('a');
        $b = $this->filename('b');
        $sql = $this->createTableSql();
        $this->Fs->write($a, $sql);
        $this->runner(array($a))->migrate();

        // a runner that only knows about filename B -- as if this were the
        // other branch's own MIGRATIONS list, same underlying database
        $this->Fs->write($b, $sql);
        $otherBranchRunner = $this->runner(array($b));

        // if the SQL actually ran again, CREATE TABLE (no guard) would
        // throw -- the table from testAppliesNewMigration-equivalent setup
        // above already exists
        $applied = $otherBranchRunner->migrate();

        $this->assertSame(0, $applied, 'nothing should have actually executed');
        $req = $this->Db->q(sprintf("SELECT checksum FROM custom_schema_migrations WHERE migration = '%s'", $b));
        $row = $req->fetch();
        $this->assertNotFalse($row, 'filename B should still be recorded as applied');
        $reqA = $this->Db->q(sprintf("SELECT checksum FROM custom_schema_migrations WHERE migration = '%s'", $a));
        $this->assertSame($reqA->fetch()['checksum'], $row['checksum']);
    }

    /** 4. Confirm a changed checksum under the same filename still fails. */
    public function testChangedChecksumUnderSameFilenameStillThrows(): void
    {
        $a = $this->filename('a');
        $this->Fs->write($a, $this->createTableSql());
        $this->runner(array($a))->migrate();

        // same filename, different content -- e.g. someone edited an
        // already-applied migration instead of adding a new one
        $this->Fs->write($a, $this->createTableSql() . ' -- edited');

        $this->expectException(ImproperActionException::class);
        $this->runner(array($a))->getPending();
    }

    /** 5. Confirm genuinely different migrations continue to execute. */
    public function testGenuinelyDifferentMigrationStillExecutes(): void
    {
        $a = $this->filename('a');
        $c = $this->filename('c');
        $this->Fs->write($a, $this->createTableSql());
        $this->runner(array($a))->migrate();

        $otherTable = $this->table . '_other';
        $this->Fs->write($c, sprintf('CREATE TABLE `%s` (id INT)', $otherTable));
        try {
            $applied = $this->runner(array($a, $c))->migrate();
            $this->assertSame(1, $applied, 'only the genuinely new migration should have run');
            $req = $this->Db->q(sprintf("SELECT checksum FROM custom_schema_migrations WHERE migration = '%s'", $c));
            $this->assertNotFalse($req->fetch());
        } finally {
            $this->Db->q(sprintf('DROP TABLE IF EXISTS `%s`', $otherTable));
        }
    }

    public function testMissingMigrationFileThrows(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->runner(array($this->filename('never_written')))->getPending();
    }
}
