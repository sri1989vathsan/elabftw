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
 * Two opt-in, per-team, admin-only Orders maintenance sweeps, both off by
 * default and both a no-op for any team that hasn't turned them on:
 *   - archive an order that's been sitting in a configured status for at
 *     least that team's own threshold (orders_autoarchive_rules);
 *   - catch up any requested order that already has a procurement ID but
 *     never got auto-advanced to ordered (orders_autoadvance_on_procurement_id)
 *     -- the event-driven trigger in OrderUploads::extractProcurementTags()
 *     only fires at the moment one is newly extracted, so this is the
 *     periodic catch-up for anything that predates that, or predates the
 *     setting being turned on at all.
 * Meant to run on a schedule (see chronos.go); safe to run manually too.
 */
#[AsCommand(name: 'orders:autoarchive')]
final class OrdersAutoArchiveCommand extends Command
{
    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Run Orders\' scheduled maintenance sweeps (auto-archive, auto-advance on procurement ID)');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $archived = Orders::autoArchivePastDue();
        $output->writeln(sprintf('Auto-archived %d order(s).', $archived));
        $advanced = Orders::autoAdvanceOnProcurementId();
        $output->writeln(sprintf('Auto-advanced %d order(s) to ordered.', $advanced));
        return Command::SUCCESS;
    }
}
