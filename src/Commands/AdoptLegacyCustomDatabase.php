<?php

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\Db;
use Override;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'custom:db:adopt-legacy')]
final class AdoptLegacyCustomDatabase extends Command
{
    public function __construct(private int $officialSchema)
    {
        parent::__construct();
    }

    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Prepare a legacy fork database whose custom migrations occupied official schema 209–216')
            ->addOption('confirm', null, InputOption::VALUE_NONE, 'Confirm that a verified backup exists');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if (!$input->getOption('confirm')) {
            $output->writeln('<error>Create and verify a database backup, then rerun with --confirm.</error>');
            return Command::FAILURE;
        }
        $Db = Db::getConnection();
        if ($this->officialSchema !== 216
            || !$this->tableExists($Db, 'html_tools')
            || $this->tableExists($Db, 'storage_units_history')) {
            $output->writeln('<error>This database does not match the known legacy fork signature; no changes were made.</error>');
            return Command::FAILURE;
        }
        // The legacy fork matched official schema 208, then reused 209–216 for
        // custom changes. Reset only the official counter so upstream can run
        // its real 209+ migrations. Existing custom objects remain in place.
        $Db->q("UPDATE config SET conf_value = '208' WHERE conf_name = 'schema'");
        $output->writeln('<info>Official schema counter reset to 208. Now run db:update, then custom:db:update.</info>');
        return Command::SUCCESS;
    }

    private function tableExists(Db $Db, string $table): bool
    {
        $req = $Db->prepare(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
        );
        $req->bindValue(':table', $table);
        $Db->execute($req);
        return (int) $req->fetchColumn() === 1;
    }
}
