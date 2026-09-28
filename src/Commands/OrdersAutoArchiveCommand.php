<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Models\Orders;
use Override;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

use function sprintf;

/**
 * Archive every order that's been sitting in 'ordered' for at least that
 * team's own orders_autoarchive_days -- an opt-in, per-team, admin-only
 * setting (0 = disabled, the default). Meant to run on a schedule (see
 * chronos.go); safe to run manually too, and a no-op for any team that
 * hasn't turned it on.
 */
#[AsCommand(name: 'orders:autoarchive')]
final class OrdersAutoArchiveCommand extends Command
{
    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Archive orders that have been \'ordered\' past a team\'s configured threshold');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $count = Orders::autoArchivePastDue();
        $output->writeln(sprintf('Auto-archived %d order(s).', $count));
        return Command::SUCCESS;
    }
}
