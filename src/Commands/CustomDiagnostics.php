<?php

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\CustomMigrationRunner;
use Elabftw\Elabftw\Db;
use Elabftw\Elabftw\SchemaVersionChecker;
use League\Flysystem\FilesystemOperator;
use Override;
use PDO;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Throwable;

use function count;
use function getenv;
use function implode;
use function is_array;
use function json_encode;

/** Report fork-owned operational state without exposing document contents. */
#[AsCommand(name: 'custom:diagnostics')]
final class CustomDiagnostics extends Command
{
    public function __construct(private int $officialSchema, private FilesystemOperator $filesystem)
    {
        parent::__construct();
    }

    #[Override]
    protected function configure(): void
    {
        $this
            ->setDescription('Report official/custom schema and scalability maintenance state')
            ->addOption('json', null, InputOption::VALUE_NONE, 'Emit machine-readable JSON');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $Db = Db::getConnection();
        $pending = array();
        $migrationError = null;
        try {
            $pending = (new CustomMigrationRunner($this->officialSchema, $this->filesystem))->getPending();
        } catch (Throwable $error) {
            $migrationError = $error->getMessage();
        }

        $report = array(
            'official_schema_current' => $this->officialSchema,
            'official_schema_required' => SchemaVersionChecker::REQUIRED_SCHEMA,
            'custom_migrations_total' => count(CustomMigrationRunner::MIGRATIONS),
            'custom_migrations_pending' => $pending,
            'custom_migration_error' => $migrationError,
            'calendar_entities_pending' => $this->calendarBacklog($Db),
            'calendar_entries' => $this->safeCount($Db, 'custom_calendar_activity_entries'),
            'completed_tasks_retained' => $this->safeCount($Db, 'todolist', 'completed_at IS NOT NULL'),
            'database_size_bytes' => $this->databaseSize($Db),
        );

        if ($input->getOption('json')) {
            $output->writeln((string) json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
            return Command::SUCCESS;
        }
        foreach ($report as $key => $value) {
            $output->writeln($key . ': ' . (is_array($value) ? implode(', ', $value) : ($value ?? 'none')));
        }
        return $migrationError === null ? Command::SUCCESS : Command::FAILURE;
    }

    private function calendarBacklog(Db $Db): int
    {
        $total = 0;
        foreach (array('experiments', 'items') as $table) {
            $req = $Db->q("SELECT COUNT(*) FROM $table AS entity
                LEFT JOIN custom_calendar_activity_index_state AS state
                    ON state.entity_type = '$table' AND state.entity_id = entity.id
                WHERE state.entity_id IS NULL OR state.source_modified_at <> entity.modified_at");
            $total += (int) $req->fetchColumn();
        }
        return $total;
    }

    private function safeCount(Db $Db, string $table, string $where = '1=1'): int
    {
        try {
            return (int) $Db->q("SELECT COUNT(*) FROM $table WHERE $where")->fetchColumn();
        } catch (Throwable) {
            return -1;
        }
    }

    private function databaseSize(Db $Db): int
    {
        $req = $Db->prepare('SELECT COALESCE(SUM(data_length + index_length), 0)
            FROM information_schema.tables WHERE table_schema = :database');
        $req->bindValue(':database', getenv('DB_NAME') ?: 'elabftw', PDO::PARAM_STR);
        $Db->execute($req);
        return (int) $req->fetchColumn();
    }
}
