<?php

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\EntityType;
use Elabftw\Services\CalendarActivityIndexer;
use Override;
use PDO;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

use function max;
use function sprintf;

/** Run bounded, fork-owned maintenance under a database advisory lock. */
#[AsCommand(name: 'custom:maintenance')]
final class Maintenance extends Command
{
    private const int BATCH_SIZE = 500;

    #[Override]
    protected function configure(): void
    {
        $this
            ->setDescription('Backfill calendar indexes and prune fork-owned history safely')
            ->addOption('retention-days', null, InputOption::VALUE_REQUIRED, 'Completed task/history retention', '365')
            ->addOption('skip-calendar', null, InputOption::VALUE_NONE, 'Skip calendar index backfill')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Report pruning without deleting rows');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $Db = Db::getConnection();
        if ((int) $Db->q("SELECT GET_LOCK('elabftw_custom_maintenance', 0)")->fetchColumn() !== 1) {
            $output->writeln('<comment>Another custom maintenance process is already running.</comment>');
            return Command::SUCCESS;
        }

        try {
            if (!$input->getOption('skip-calendar')) {
                $this->backfillCalendar($Db, $output);
            }
            $days = max(1, (int) $input->getOption('retention-days'));
            $dryRun = (bool) $input->getOption('dry-run');
            $this->prune($Db, 'storage_units_history', 'created_at', $days, $dryRun, $output);
            $this->prune($Db, 'todolist', 'completed_at', $days, $dryRun, $output, 'completed_at IS NOT NULL AND ');
            $this->deleteOrphanedCalendarRows($Db, $dryRun, $output);
        } finally {
            $Db->q("SELECT RELEASE_LOCK('elabftw_custom_maintenance')");
        }
        return Command::SUCCESS;
    }

    private function backfillCalendar(Db $Db, OutputInterface $output): void
    {
        $teamIds = $Db->q('SELECT id FROM teams')->fetchAll(PDO::FETCH_COLUMN);
        $Indexer = new CalendarActivityIndexer();
        $total = 0;
        foreach ($teamIds as $teamId) {
            foreach (array(EntityType::Experiments, EntityType::Items) as $entityType) {
                while (($count = $Indexer->synchronizeTeam($entityType, (int) $teamId, self::BATCH_SIZE)) > 0) {
                    $total += $count;
                }
            }
        }
        $output->writeln(sprintf('Calendar index: processed %d changed entities.', $total));
    }

    private function prune(
        Db $Db,
        string $table,
        string $dateColumn,
        int $days,
        bool $dryRun,
        OutputInterface $output,
        string $extraWhere = '',
    ): void {
        $where = sprintf('%s%s < DATE_SUB(NOW(), INTERVAL :days DAY)', $extraWhere, $dateColumn);
        $count = $Db->prepare(sprintf('SELECT COUNT(*) FROM %s WHERE %s', $table, $where));
        $count->bindValue(':days', $days, PDO::PARAM_INT);
        $Db->execute($count);
        $rows = (int) $count->fetchColumn();
        if ($rows > 0 && !$dryRun) {
            $delete = $Db->prepare(sprintf('DELETE FROM %s WHERE %s', $table, $where));
            $delete->bindValue(':days', $days, PDO::PARAM_INT);
            $Db->execute($delete);
        }
        $output->writeln(sprintf('%s %d old row(s) from %s.', $dryRun ? 'Would delete' : 'Deleted', $rows, $table));
    }

    private function deleteOrphanedCalendarRows(Db $Db, bool $dryRun, OutputInterface $output): void
    {
        $total = 0;
        foreach (array(EntityType::Experiments, EntityType::Items) as $type) {
            foreach (array('custom_calendar_activity_entries', 'custom_calendar_activity_index_state') as $table) {
                $count = $Db->prepare(sprintf(
                    'SELECT COUNT(*) FROM %s AS custom LEFT JOIN %s AS entity ON entity.id = custom.entity_id WHERE custom.entity_type = :type AND entity.id IS NULL',
                    $table,
                    $type->value,
                ));
                $count->bindValue(':type', $type->value);
                $Db->execute($count);
                $rows = (int) $count->fetchColumn();
                $total += $rows;
                if ($rows > 0 && !$dryRun) {
                    $delete = $Db->prepare(sprintf(
                        'DELETE custom FROM %s AS custom LEFT JOIN %s AS entity ON entity.id = custom.entity_id WHERE custom.entity_type = :type AND entity.id IS NULL',
                        $table,
                        $type->value,
                    ));
                    $delete->bindValue(':type', $type->value);
                    $Db->execute($delete);
                }
            }
        }
        $output->writeln(sprintf('%s %d orphaned calendar index row(s).', $dryRun ? 'Would delete' : 'Deleted', $total));
    }
}
