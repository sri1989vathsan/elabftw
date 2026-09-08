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

use function sprintf;

#[AsCommand(name: 'custom:db:update')]
final class UpdateCustomDatabase extends Command
{
    public function __construct(private int $officialSchema, private FilesystemOperator $filesystem)
    {
        parent::__construct();
    }

    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Apply fork-owned database migrations');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $count = (new CustomMigrationRunner($this->officialSchema, $this->filesystem, $output))->migrate();
        $output->writeln($count === 0
            ? '<info>Custom database schema is current.</info>'
            : sprintf('<info>Applied %d custom migration(s).</info>', $count));
        return Command::SUCCESS;
    }
}
