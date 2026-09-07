<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Models\OrderUploads;
use Override;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Run PDF text extraction for order attachments in the background, so a
 * large PDF doesn't make the upload request itself slow. Invoked with an id
 * right after upload (OrderUploads::postAction()); invoked with no id, it
 * sweeps every upload still stuck 'pending' (e.g. if the invoker was
 * unreachable at upload time) -- safe to run manually or on a schedule.
 */
#[AsCommand(name: 'orders:extract-pdf')]
final class OrdersExtractPdfCommand extends Command
{
    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Extract text from a pending order attachment PDF')
            ->setHelp('Without an ID as argument, this command will process all uploads still pending extraction.')
            ->addArgument('id', InputArgument::OPTIONAL, 'The order upload id to process');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $id = $input->getArgument('id');
        if ($id) {
            OrderUploads::extractOne((int) $id);
            return Command::SUCCESS;
        }
        foreach (OrderUploads::pendingIds() as $pendingId) {
            OrderUploads::extractOne($pendingId);
        }
        return Command::SUCCESS;
    }
}
