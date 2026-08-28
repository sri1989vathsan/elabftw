<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\EntityType;
use Elabftw\Services\CalendarActivityIndexer;
use PDO;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Override;

use function sprintf;

/**
 * Drain the fork-owned calendar activity index backlog outside of a user request.
 *
 * CalendarActivity indexes entities incrementally the first time a team's calendar is
 * viewed, capped per request. Run this once after deploying the feature (or after a bulk
 * import) so teams with a large backlog don't rely on several page views to catch up.
 */
#[AsCommand(name: 'custom:calendar-backfill')]
final class CalendarActivityBackfill extends Command
{
    private const int BATCH_SIZE = 500;

    #[Override]
    protected function configure(): void
    {
        $this
            ->setDescription('Backfill the fork-owned calendar activity index for one or all teams')
            ->addOption('team', null, InputOption::VALUE_REQUIRED, 'Limit to a single team id')
            ->setHelp('Run after deploying the calendar activity feature, or after a bulk import, so calendars are already up to date instead of catching up over several requests.');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $teamOption = $input->getOption('team');
        $teamIds = $teamOption !== null ? array((int) $teamOption) : $this->getAllTeamIds();

        $Indexer = new CalendarActivityIndexer();
        $total = 0;
        foreach ($teamIds as $teamId) {
            foreach (array(EntityType::Experiments, EntityType::Items) as $entityType) {
                $indexed = 0;
                while (($count = $Indexer->synchronizeTeam($entityType, $teamId, self::BATCH_SIZE)) > 0) {
                    $indexed += $count;
                    $total += $count;
                }
                if ($indexed > 0) {
                    $output->writeln(sprintf('Team %d: indexed %d %s', $teamId, $indexed, $entityType->value));
                }
            }
        }
        $output->writeln(sprintf('Done. Indexed %d entities in total.', $total));
        return Command::SUCCESS;
    }

    /** @return list<int> */
    private function getAllTeamIds(): array
    {
        $Db = Db::getConnection();
        $req = $Db->q('SELECT id FROM teams');
        return $req->fetchAll(PDO::FETCH_COLUMN);
    }
}
