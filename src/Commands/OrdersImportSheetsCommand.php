<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use Elabftw\Elabftw\Db;
use Elabftw\Models\OrderSheets;
use Elabftw\Models\Users\Users;
use Override;
use PDO;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Throwable;

use function basename;
use function date;
use function file_exists;
use function filemtime;
use function getenv;
use function glob;
use function is_dir;
use function mkdir;
use function preg_match;
use function rename;
use function sprintf;
use function strtolower;
use function time;

/**
 * Watches a folder for the signed shop sheets (PDF scans): every new file gets the same treatment as one dropped on the
 * orders page (the number after "Rüstschein" is read, the PDF is attached to the orders with that procurement ID, they
 * become "collected" and the people who placed them are notified). Runs every minute (see chronos.go).
 *
 * The folder is ORDER_SHEETS_DIR (default /var/lib/elabftw/order-sheets); ORDER_SHEETS_USERID is the account the
 * attachments are attributed to (default: the first sysadmin), and its team is the one whose orders are matched.
 * Handled files move to done/, to unmatched/ (no order has that number yet: tried again on each run, without reading
 * the scan a second time) or to unreadable/ (no number could be read, or not a PDF).
 */
#[AsCommand(name: 'orders:import-sheets')]
final class OrdersImportSheetsCommand extends Command
{
    private const int SETTLE_SECONDS = 15;

    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Import new shop sheets from the watched folder and attach them to their orders');
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $dir = getenv('ORDER_SHEETS_DIR') ?: '/var/lib/elabftw/order-sheets';
        if (!is_dir($dir)) {
            return Command::SUCCESS;
        }
        $requester = $this->requester();
        if ($requester === null) {
            $output->writeln('No user to attribute the sheets to (set ORDER_SHEETS_USERID).');
            return Command::FAILURE;
        }
        $sheets = new OrderSheets($requester);
        // sheets recorded before their procurement's item list was readable are matched again
        $rescanned = $sheets->rescan();
        if ($rescanned > 0) {
            $output->writeln(sprintf('%d recorded sheet(s) matched again against their confirmation.', $rescanned));
        }
        $files = array_merge(glob($dir . '/*.[pP][dD][fF]') ?: array(), glob($dir . '/unmatched/*.[pP][dD][fF]') ?: array());
        if ($files === array()) {
            return Command::SUCCESS;
        }
        foreach ($files as $path) {
            // a scanner may still be writing the file
            if (time() - (int) filemtime($path) < self::SETTLE_SECONDS) {
                continue;
            }
            $name = basename($path);
            $known = null;
            $original = $name;
            if (str_contains($path, '/unmatched/') && preg_match('/^(\d{6,10})__(.+)$/', $name, $matches) === 1) {
                [$known, $original] = array($matches[1], $matches[2]);
            }
            try {
                $result = $sheets->process(new UploadedFile($path, $original, 'application/pdf', null, true), $known);
            } catch (Throwable $e) {
                $output->writeln(sprintf('%s: %s', $name, $e->getMessage()));
                continue;
            }
            $output->writeln(sprintf('%s: %s%s', $name, $result['status'], $result['procurement_id'] !== null ? ' (' . $result['procurement_id'] . ')' : ''));
            if ($result['status'] === 'no_order' && $known !== null) {
                continue; // stays in unmatched/, tried again on the next run
            }
            $target = match ($result['status']) {
                'attached' => 'done',
                'no_order' => 'unmatched',
                default => 'unreadable',
            };
            $newName = $result['status'] === 'no_order' ? $result['procurement_id'] . '__' . $original : date('Ymd-His') . '_' . $original;
            if (!is_dir($dir . '/' . $target) && !mkdir($dir . '/' . $target, 0775, true) && !is_dir($dir . '/' . $target)) {
                continue;
            }
            if (!file_exists($dir . '/' . $target . '/' . $newName)) {
                rename($path, $dir . '/' . $target . '/' . $newName);
            }
        }
        return Command::SUCCESS;
    }

    private function requester(): ?Users
    {
        $Db = Db::getConnection();
        $configured = (int) (getenv('ORDER_SHEETS_USERID') ?: 0);
        $sql = $configured > 0
            ? 'SELECT userid FROM users WHERE userid = :id'
            : 'SELECT userid FROM users WHERE is_sysadmin = 1 ORDER BY userid LIMIT 1';
        $req = $Db->prepare($sql);
        if ($configured > 0) {
            $req->bindValue(':id', $configured, PDO::PARAM_INT);
        }
        $Db->execute($req);
        $userid = $req->fetchColumn();
        if ($userid === false) {
            return null;
        }
        $teamReq = $Db->prepare('SELECT teams_id FROM users2teams WHERE users_id = :id ORDER BY teams_id LIMIT 1');
        $teamReq->bindValue(':id', (int) $userid, PDO::PARAM_INT);
        $Db->execute($teamReq);
        $team = $teamReq->fetchColumn();
        return new Users((int) $userid, $team === false ? 1 : (int) $team);
    }
}
