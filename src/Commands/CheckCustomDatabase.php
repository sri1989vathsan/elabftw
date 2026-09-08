<?php

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\CustomMigrationRunner;
use League\Flysystem\FilesystemOperator;
use Override;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

use function count;
use function sprintf;

#[AsCommand(name: 'custom:db:check')]
final class CheckCustomDatabase extends Command
{
    public function __construct(private int $officialSchema, private FilesystemOperator $filesystem)
    {
        parent::__construct();
    }

    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Check fork-owned database migrations');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $pending = (new CustomMigrationRunner($this->officialSchema, $this->filesystem))->getPending();
        $output->writeln(sprintf(
            'Custom migrations: %d applied, %d pending.',
            count(CustomMigrationRunner::MIGRATIONS) - count($pending),
            count($pending),
        ));
        foreach ($pending as $migration) {
            $output->writeln(sprintf('  - %s', $migration));
        }
        return $pending === array() ? Command::SUCCESS : Command::FAILURE;
    }
}
