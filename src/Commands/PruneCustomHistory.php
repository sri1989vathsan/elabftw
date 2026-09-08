<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\Db;
use PDO;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Override;

use function sprintf;

/**
 * Prune fork-owned append-only history that has no retention policy of its own:
 * storage unit move history, and completed to-do items (kept instead of deleted
 * since the "todolist history" fork migration, so they no longer self-limit).
 */
#[AsCommand(name: 'custom:prune-history')]
final class PruneCustomHistory extends Command
{
    private const int DEFAULT_RETENTION_DAYS = 365;

    #[Override]
    protected function configure(): void
    {
        $this
            ->setDescription('Delete fork-owned history rows older than the retention period')
            ->addOption(
                'days',
                null,
                InputOption::VALUE_REQUIRED,
                'Retention period in days',
                (string) self::DEFAULT_RETENTION_DAYS,
            )
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Report what would be deleted without deleting it')
            ->setHelp('Intended to run periodically (e.g. from cron) so storage_units_history and completed todolist items do not grow unbounded.');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $days = (int) $input->getOption('days');
        $dryRun = (bool) $input->getOption('dry-run');
        $Db = Db::getConnection();

        $storageDeleted = $this->prune(
            $Db,
            'SELECT COUNT(*) FROM storage_units_history WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)',
            'DELETE FROM storage_units_history WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)',
            $days,
            $dryRun,
        );
        $output->writeln(sprintf(
            '%s %d row(s) from storage_units_history older than %d days.',
            $dryRun ? 'Would delete' : 'Deleted',
            $storageDeleted,
            $days,
        ));

        $todosDeleted = $this->prune(
            $Db,
            'SELECT COUNT(*) FROM todolist WHERE completed_at IS NOT NULL AND completed_at < DATE_SUB(NOW(), INTERVAL :days DAY)',
            'DELETE FROM todolist WHERE completed_at IS NOT NULL AND completed_at < DATE_SUB(NOW(), INTERVAL :days DAY)',
            $days,
            $dryRun,
        );
        $output->writeln(sprintf(
            '%s %d completed todolist row(s) older than %d days.',
            $dryRun ? 'Would delete' : 'Deleted',
            $todosDeleted,
            $days,
        ));

        return Command::SUCCESS;
    }

    private function prune(Db $Db, string $countSql, string $deleteSql, int $days, bool $dryRun): int
    {
        $countReq = $Db->prepare($countSql);
        $countReq->bindValue(':days', $days, PDO::PARAM_INT);
        $Db->execute($countReq);
        $count = (int) $countReq->fetchColumn();

        if ($count > 0 && !$dryRun) {
            $deleteReq = $Db->prepare($deleteSql);
            $deleteReq->bindValue(':days', $days, PDO::PARAM_INT);
            $Db->execute($deleteReq);
        }
        return $count;
    }
}
