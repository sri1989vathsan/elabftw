<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\ImproperActionException;
use League\Flysystem\FilesystemOperator;
use PDO;
use Symfony\Component\Console\Output\OutputInterface;

use function hash;
use function sprintf;

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
        '035_orders.sql',
        '036_order_uploads.sql',
        '037_order_archive.sql',
        '038_order_upload_text.sql',
    );

    private Db $Db;

    public function __construct(
        private readonly int $officialSchema,
        private readonly FilesystemOperator $filesystem,
        private readonly ?OutputInterface $output = null,
    ) {
        $this->Db = Db::getConnection();
    }

    /** @return list<string> */
    public function getPending(): array
    {
        $this->assertOfficialSchemaIsCurrent();
        $this->ensureLedger();
        $applied = $this->getApplied();
        $pending = array();
        foreach (self::MIGRATIONS as $migration) {
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
            $pending[] = $migration;
        }
        return $pending;
    }

    public function migrate(): int
    {
        $pending = $this->getPending();
        $Sql = new Sql($this->filesystem, $this->output);
        foreach ($pending as $migration) {
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
}
