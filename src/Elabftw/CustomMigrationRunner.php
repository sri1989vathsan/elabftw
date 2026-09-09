<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\Storage;
use Elabftw\Exceptions\ImproperActionException;
use League\Flysystem\FilesystemOperator;
use PDO;
use Symfony\Component\Console\Output\OutputInterface;

use function array_flip;
use function array_unique;
use function array_values;
use function date;
use function fclose;
use function fopen;
use function fwrite;
use function hash;
use function json_encode;
use function pathinfo;
use function preg_match_all;
use function rewind;
use function sprintf;

use const JSON_THROW_ON_ERROR;
use const PATHINFO_FILENAME;

/**
 * Apply fork-owned migrations without consuming upstream schema numbers.
 */
final class CustomMigrationRunner
{
    /** @var list<string> */
    public const array MIGRATIONS = array(
        '001_experiment_folders.sql',
        '002_favorite_filters.sql',
        '003_spreadsheet_defaults.sql',
        '004_todolist_deadlines.sql',
        '005_calendar_and_theme.sql',
        '006_todolist_history.sql',
        '007_html_tools.sql',
        '008_pyrat_links.sql',
        '009_ui_descriptions.sql',
        '010_experiment_summaries.sql',
        '011_resource_folders.sql',
        '012_multiple_folder_bookmarks.sql',
        '013_folder_readmes.sql',
        '014_scalability_indexes.sql',
        '015_editor_defaults.sql',
        '016_entity_review_decisions.sql',
        '017_template_version.sql',
        '018_step_details.sql',
        '019_template_version_history.sql',
        '020_template_favorites.sql',
        '021_created_from_version.sql',
        '022_experiment_template_inserts.sql',
        '023_feedback_board.sql',
        '024_feedback_comments.sql',
        '025_todolist_assignment.sql',
        '026_todolist_projects.sql',
        '027_todolist_description_comments.sql',
        '028_openiris_link.sql',
        '029_todolist_multi_assignee.sql',
        '030_labcollector_link.sql',
        '031_todolist_entity_links.sql',
        '032_todolist_steps.sql',
        '033_todolist_status_priority.sql',
        '034_todolist_columns.sql',
        '035_notif_mentioned.sql',
        '036_notif_task_assigned.sql',
        '037_todolist_columns_per_project.sql',
        '038_project_details_and_pinning.sql',
        '050_todolist_project_archive.sql',
        '051_todolist_project_ordering.sql',
    );

    private Db $Db;

    /** @param list<string>|null $migrationsOverride only ever set by tests -- production always uses self::MIGRATIONS */
    public function __construct(
        private readonly int $officialSchema,
        private readonly FilesystemOperator $filesystem,
        private readonly ?OutputInterface $output = null,
        private readonly ?array $migrationsOverride = null,
    ) {
        $this->Db = Db::getConnection();
    }

    /** @return list<string> */
    private function migrationList(): array
    {
        return $this->migrationsOverride ?? self::MIGRATIONS;
    }

    /**
     * Usability and Orders assign different filenames/numbers to a handful
     * of otherwise-identical migrations (e.g. usability's
     * 035_notif_mentioned.sql is byte-for-byte the same change as Orders'
     * 039_notif_mentioned.sql). Tracking by filename alone means a database
     * that moves from one branch to the other would see its own branch's
     * filename as never having run and try the same schema change again --
     * harmless for a guarded ALTER TABLE like these, but not guaranteed in
     * general, and not something to rely on. If this exact migration's
     * checksum already ran under some other filename, record it under this
     * one too (so this branch's own future runs recognize it via a normal
     * filename lookup) without re-executing the SQL.
     *
     * @return list<string>
     */
    public function getPending(): array
    {
        $this->assertOfficialSchemaIsCurrent();
        $this->ensureLedger();
        $applied = $this->getApplied();
        $appliedChecksums = array_flip($applied);
        $pending = array();
        foreach ($this->migrationList() as $migration) {
            if (!$this->filesystem->fileExists($migration)) {
                throw new ImproperActionException(sprintf('Custom migration file is missing: %s', $migration));
            }
            $checksum = hash('sha256', $this->filesystem->read($migration));
            if (isset($applied[$migration])) {
                if ($applied[$migration] !== $checksum) {
                    throw new ImproperActionException(sprintf(
                        'Applied custom migration %s was modified. Add a new migration instead.',
                        $migration,
                    ));
                }
                continue;
            }
            if (isset($appliedChecksums[$checksum])) {
                $this->recordAppliedWithoutRunning($migration, $checksum);
                continue;
            }
            $pending[] = $migration;
        }
        return $pending;
    }

    public function migrate(): int
    {
        $pending = $this->getPending();
        $Sql = new Sql($this->filesystem, $this->output);
        foreach ($pending as $migration) {
            $this->backupIfDestructive($migration);
            $Sql->execFile($migration);
            $checksum = hash('sha256', $this->filesystem->read($migration));
            $req = $this->Db->prepare(
                'INSERT INTO custom_schema_migrations (migration, checksum) VALUES (:migration, :checksum)',
            );
            $req->bindValue(':migration', $migration);
            $req->bindValue(':checksum', $checksum);
            $this->Db->execute($req);
        }
        return count($pending);
    }

    /**
     * A migration is not run inside a transaction (its DDL statements would
     * auto-commit each one regardless -- MySQL has no transactional DDL),
     * so there is nothing to roll back from a problem only discovered
     * after the fact. As a safety net, before running a migration that
     * drops a column or table, dump that table's current full contents --
     * cheap, and it's the data such a statement could make unrecoverable.
     * Only the table(s) actually named in a DROP COLUMN/TABLE are dumped
     * (not every custom_* table), and each is streamed straight from the
     * result set to storage one row at a time rather than built up as one
     * big in-memory array/JSON string, so this stays cheap even once
     * calendar history, extracted PDF text, etc. have grown large.
     *
     * This is not a substitute for a real backup before a major upgrade --
     * the mysqldump binary lives in the mysql container, not this one:
     *   docker exec <mysql container> mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
     *     --databases elabftw --result-file=/tmp/pre-upgrade-backup.sql
     *     && docker cp <mysql container>:/tmp/pre-upgrade-backup.sql .
     * Take that before running `bin/console custom:db:update` for the
     * first time after upgrading to a version with a new destructive
     * migration -- this method is just a narrower, automatic last resort.
     */
    private function backupIfDestructive(string $migration): void
    {
        $sql = $this->filesystem->read($migration);
        $tables = $this->getDroppedFromTables($sql);
        if ($tables === array()) {
            return;
        }
        $backupFs = Storage::EXPORTS->getStorage()->getFs();
        $timestamp = date('Y-m-d_His');
        $migrationName = pathinfo($migration, PATHINFO_FILENAME);
        foreach ($tables as $table) {
            $filename = sprintf('pre-migration-backup_%s_%s_%s.jsonl', $timestamp, $migrationName, $table);
            $stream = fopen('php://temp', 'w+b');
            if ($stream === false) {
                continue; // best-effort safety net -- never block the migration itself on this
            }
            $req = $this->Db->q(sprintf('SELECT * FROM `%s`', $table));
            while (($row = $req->fetch(PDO::FETCH_ASSOC)) !== false) {
                fwrite($stream, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
            }
            rewind($stream);
            $backupFs->writeStream($filename, $stream);
            fclose($stream);
            $this->output?->writeln(sprintf(
                '<comment>%s drops from `%s` -- backed it up to exports/%s first.</comment>',
                $migration,
                $table,
                $filename,
            ));
        }
    }

    /**
     * Best-effort: the table names a migration's DROP COLUMN/TABLE
     * statements target. The dynamic guarded-ALTER pattern this codebase's
     * migrations use embeds the real DDL as a single-quoted string
     * literal (e.g. 'ALTER TABLE custom_orders DROP COLUMN item_id'), so
     * matching stops at the closing quote rather than assuming any
     * particular statement structure around it.
     *
     * @return list<string>
     */
    private function getDroppedFromTables(string $sql): array
    {
        $tables = array();
        if (preg_match_all('/ALTER\s+TABLE\s+`?(\w+)`?[^\']*?DROP\s+(?:COLUMN|TABLE)/i', $sql, $matches)) {
            $tables = array(...$tables, ...$matches[1]);
        }
        if (preg_match_all('/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/i', $sql, $matches)) {
            $tables = array(...$tables, ...$matches[1]);
        }
        return array_values(array_unique($tables));
    }

    private function assertOfficialSchemaIsCurrent(): void
    {
        if ($this->officialSchema !== SchemaVersionChecker::REQUIRED_SCHEMA) {
            throw new ImproperActionException(sprintf(
                'Official database schema must be updated first (current: %d, required: %d). Run bin/console db:update.',
                $this->officialSchema,
                SchemaVersionChecker::REQUIRED_SCHEMA,
            ));
        }
    }

    private function ensureLedger(): void
    {
        $this->Db->q(
            'CREATE TABLE IF NOT EXISTS custom_schema_migrations (
                migration VARCHAR(128) NOT NULL,
                checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (migration)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
        );
    }

    /** @return array<string, string> */
    private function getApplied(): array
    {
        $req = $this->Db->q('SELECT migration, checksum FROM custom_schema_migrations ORDER BY migration');
        $applied = array();
        while ($row = $req->fetch(PDO::FETCH_ASSOC)) {
            $applied[(string) $row['migration']] = (string) $row['checksum'];
        }
        return $applied;
    }

    private function recordAppliedWithoutRunning(string $migration, string $checksum): void
    {
        $req = $this->Db->prepare(
            'INSERT INTO custom_schema_migrations (migration, checksum) VALUES (:migration, :checksum)',
        );
        $req->bindValue(':migration', $migration);
        $req->bindValue(':checksum', $checksum);
        $this->Db->execute($req);
    }
}
