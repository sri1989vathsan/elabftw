<?php

declare(strict_types=1);
/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\DatabaseErrorException;
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

    protected function setUp(): void
    {
        $this->Fs = new Fs(new InMemoryFilesystemAdapter());
        $this->Db = Db::getConnection();
        // a fresh, uniquely-named table per test run so CREATE TABLE (no
        // guard) fails loudly if a migration is ever actually re-executed,
        // and so parallel/repeated test runs never collide with each other
        $this->table = 'test_migration_runner_' . uniqid();
    }

    protected function tearDown(): void
    {
        $this->Db->q(sprintf('DROP TABLE IF EXISTS `%s`', $this->table));
        $this->Db->q("DELETE FROM custom_schema_migrations WHERE migration LIKE 'zzz_test_%'");
    }

    private function runner(array $migrations): CustomMigrationRunner
    {
        return new CustomMigrationRunner(SchemaVersionChecker::REQUIRED_SCHEMA, $this->Fs, null, $migrations);
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
        $this->Fs->write('zzz_test_a.sql', $this->createTableSql());
        $applied = $this->runner(array('zzz_test_a.sql'))->migrate();

        $this->assertSame(1, $applied);
        $req = $this->Db->q("SELECT checksum FROM custom_schema_migrations WHERE migration = 'zzz_test_a.sql'");
        $this->assertNotFalse($req->fetch());
    }

    /**
     * 2. Present identical SQL under filename B.
     * 3. Confirm B is recorded without executing the SQL again.
     */
    public function testIdenticalContentUnderAnotherFilenameIsRecordedWithoutReexecution(): void
    {
        $sql = $this->createTableSql();
        $this->Fs->write('zzz_test_a.sql', $sql);
        $this->runner(array('zzz_test_a.sql'))->migrate();

        // a runner that only knows about filename B -- as if this were the
        // other branch's own MIGRATIONS list, same underlying database
        $this->Fs->write('zzz_test_b.sql', $sql);
        $otherBranchRunner = $this->runner(array('zzz_test_b.sql'));

        // if the SQL actually ran again, CREATE TABLE (no guard) would
        // throw -- the table from testAppliesNewMigration-equivalent setup
        // above already exists
        $applied = $otherBranchRunner->migrate();

        $this->assertSame(0, $applied, 'nothing should have actually executed');
        $req = $this->Db->q("SELECT checksum FROM custom_schema_migrations WHERE migration = 'zzz_test_b.sql'");
        $row = $req->fetch();
        $this->assertNotFalse($row, 'filename B should still be recorded as applied');
        $reqA = $this->Db->q("SELECT checksum FROM custom_schema_migrations WHERE migration = 'zzz_test_a.sql'");
        $this->assertSame($reqA->fetch()['checksum'], $row['checksum']);
    }

    /** 4. Confirm a changed checksum under the same filename still fails. */
    public function testChangedChecksumUnderSameFilenameStillThrows(): void
    {
        $this->Fs->write('zzz_test_a.sql', $this->createTableSql());
        $this->runner(array('zzz_test_a.sql'))->migrate();

        // same filename, different content -- e.g. someone edited an
        // already-applied migration instead of adding a new one
        $this->Fs->write('zzz_test_a.sql', $this->createTableSql() . ' -- edited');

        $this->expectException(ImproperActionException::class);
        $this->runner(array('zzz_test_a.sql'))->getPending();
    }

    /** 5. Confirm genuinely different migrations continue to execute. */
    public function testGenuinelyDifferentMigrationStillExecutes(): void
    {
        $this->Fs->write('zzz_test_a.sql', $this->createTableSql());
        $this->runner(array('zzz_test_a.sql'))->migrate();

        $otherTable = $this->table . '_other';
        $this->Fs->write('zzz_test_c.sql', sprintf('CREATE TABLE `%s` (id INT)', $otherTable));
        try {
            $applied = $this->runner(array('zzz_test_a.sql', 'zzz_test_c.sql'))->migrate();
            $this->assertSame(1, $applied, 'only the genuinely new migration should have run');
            $req = $this->Db->q("SELECT checksum FROM custom_schema_migrations WHERE migration = 'zzz_test_c.sql'");
            $this->assertNotFalse($req->fetch());
        } finally {
            $this->Db->q(sprintf('DROP TABLE IF EXISTS `%s`', $otherTable));
        }
    }

    public function testMissingMigrationFileThrows(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->runner(array('zzz_test_never_written.sql'))->getPending();
    }
}
