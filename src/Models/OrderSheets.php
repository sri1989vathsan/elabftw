<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Notifications\OrderChanged;
use Elabftw\Models\Users\Users;
use Elabftw\Enums\Storage;
use Elabftw\Services\ScanReader;
use Override;
use PDO;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Throwable;

use function array_key_exists;
use function count;
use function mb_strtolower;
use function pathinfo;
use function levenshtein;
use function mb_strtoupper;
use function preg_replace;
use function array_column;
use function array_fill;
use function array_filter;
use function explode;
use function implode;
use function mb_strimwidth;
use function file_put_contents;
use function sprintf;
use function sys_get_temp_dir;
use function tempnam;
use function unlink;
use function str_contains;
use function strlen;
use function substr;

/**
 * Signed shop sheets dropped on the orders page: the procurement number after "Rüstschein" is read from each PDF, the
 * PDF is attached to every order of the team with that procurement ID, and the people who placed those orders are told
 * that their orders have arrived.
 */
final class OrderSheets extends AbstractRest
{
    public function __construct(private Users $requester, private ?int $id = null)
    {
        parent::__construct();
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/order_sheets/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        throw new ImproperActionException('Use the file upload for this endpoint.');
    }

    /**
     * @return array{file: string, procurement_id: string|null, orders: list<array{id: int, title: string}>, notified: int, collected?: int, items?: array{collected: int, total: int}, status: string}
     */
    public function process(UploadedFile $file, ?string $knownProcurementId = null): array
    {
        $realName = $file->getClientOriginalName();
        $result = array('file' => $realName, 'procurement_id' => null, 'orders' => array(), 'notified' => 0, 'status' => 'unreadable');
        if (mb_strtolower(pathinfo($realName, PATHINFO_EXTENSION)) !== 'pdf') {
            $result['status'] = 'not_pdf';
            return $result;
        }
        // the text of the sheet is read once (text layer or OCR); a sheet kept in the watched folder's unmatched list
        // already has its number in the name, so it is only read when an order for it turns up
        $text = null;
        if ($knownProcurementId === null) {
            $text = ScanReader::textFromPdf($file->getPathname());
        }
        $procurementId = $knownProcurementId ?? ScanReader::parseProcurementId((string) $text);
        if ($procurementId === null) {
            return $result;
        }
        $result['procurement_id'] = $procurementId;

        $team = (int) $this->requester->userData['team'];
        $req = $this->Db->prepare('SELECT id, userid, title FROM custom_orders
            WHERE team = :team AND procurement_id = :procurement_id ORDER BY id');
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($req);
        $orders = $req->fetchAll(PDO::FETCH_ASSOC);
        if ($orders === array()) {
            $result['status'] = 'no_order';
            return $result;
        }

        $text ??= ScanReader::textFromPdf($file->getPathname());
        $byOwner = array();
        $collected = 0;
        $firstUploadId = null;
        foreach ($orders as $order) {
            $orderId = (int) $order['id'];
            // dropping the same sheet twice must not attach it twice
            $existingUploadId = $this->attachedUploadId($orderId, $realName, (int) $file->getSize());
            $isNew = $existingUploadId === null;
            if ($isNew) {
                $existingUploadId = (new OrderUploads($this->requester, new Orders($this->requester, $orderId)))->postAction(
                    Action::Create,
                    array('file' => $file, 'real_name' => $realName, 'silent' => true),
                );
            }
            $firstUploadId ??= $existingUploadId;
            // the goods are here: only an ordered order becomes "collected"; any other status stays as it is
            $collected += $this->markCollected($orderId);
            $result['orders'][] = array('id' => $orderId, 'title' => (string) $order['title']);
            // only a sheet that was not attached before counts as news for the person who placed the order
            if ($isNew) {
                $byOwner[(int) $order['userid']][] = array('id' => $orderId, 'title' => (string) $order['title']);
            }
        }
        // the sheet itself, and the items found on it
        $sheetId = $this->saveSheet($team, $procurementId, $realName, (int) $file->getSize(), $firstUploadId);
        $progress = $this->recordCollectedItems($procurementId, $text, $realName, $sheetId);
        if ($progress !== null) {
            $result['items'] = $progress;
        }
        // one notification per person (not per order), whoever dropped the sheet: everyone with an order on it is told
        foreach ($byOwner as $ownerId => $owned) {
            // the order names this person has on the procurement, kept short
            $title = mb_strimwidth(implode(', ', array_column($owned, 'title')), 0, 120, '…');
            (new OrderChanged(
                new Users($ownerId, $team),
                $this->requester,
                $owned[0]['id'],
                $title,
                'received',
                $progress === null ? null : sprintf('%d/%d', $progress['collected'], $progress['total']),
                $procurementId,
            ))->create();
            $result['notified']++;
        }
        $result['status'] = 'attached';
        $result['collected'] = $collected;
        return $result;
    }

    /**
     * Notes which items of the procurement this sheet covers: the article numbers read from the sheet are compared with
     * the rows of the basket in the procurement's confirmation PDF. Returns how many items are collected so far, or null
     * when no confirmation with a basket is attached to an order of this procurement.
     *
     * @return array{collected: int, total: int}|null
     */
    private function recordCollectedItems(string $procurementId, string $sheetText, string $sheetName, int $sheetId): ?array
    {
        $team = (int) $this->requester->userData['team'];
        $req = $this->Db->prepare("SELECT u.extracted_text FROM custom_order_uploads AS u
            INNER JOIN custom_orders AS o ON o.id = u.order_id
            WHERE o.team = :team AND (u.procurement_id = :procurement_id OR o.procurement_id = :procurement_id)
                AND u.extracted_text LIKE '%Warenkorb%' ORDER BY u.id DESC LIMIT 1");
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($req);
        $confirmation = $req->fetchColumn();
        $items = $confirmation === false ? array() : ScanReader::basketItems((string) $confirmation);
        if ($items === array()) {
            return null;
        }
        $tokens = ScanReader::articleTokens($sheetText);
        $insert = $this->Db->prepare('INSERT IGNORE INTO custom_order_sheet_items (team, procurement_id, item_index, sheet_id, article, sheet_name)
            VALUES (:team, :procurement_id, :item_index, :sheet_id, :article, :sheet_name)');
        $sheetLines = array();
        foreach (explode("\n", $sheetText) as $line) {
            $line = (string) preg_replace('/[^A-Z0-9]/', '', mb_strtoupper($line));
            if (strlen($line) >= 12) {
                $sheetLines[] = $line;
            }
        }
        foreach ($items as $index => $itemText) {
            // the article number first; when a scan garbles it (a crease or a stamp through the cell), the item's
            // description printed next to it is compared instead
            $candidates = $tokens;
            if (!array_filter($tokens, static fn (string $token): bool => self::articleMatches($itemText, $token))
                && self::descriptionMatches($itemText, $sheetLines)
            ) {
                $candidates = array('(description)');
            }
            foreach ($candidates as $token) {
                if ($token === '(description)' || self::articleMatches($itemText, $token)) {
                    $insert->bindValue(':team', $team, PDO::PARAM_INT);
                    $insert->bindValue(':procurement_id', $procurementId);
                    $insert->bindValue(':item_index', $index, PDO::PARAM_INT);
                    $insert->bindValue(':sheet_id', $sheetId, PDO::PARAM_INT);
                    $insert->bindValue(':article', $token);
                    $insert->bindValue(':sheet_name', $sheetName);
                    $this->Db->execute($insert);
                    break;
                }
            }
        }
        $found = $this->Db->prepare('UPDATE custom_order_sheets SET basket_seen = :basket_seen,
            items_found = (SELECT COUNT(DISTINCT item_index) FROM custom_order_sheet_items WHERE sheet_id = :sheet_id) WHERE id = :sheet_id2');
        $found->bindValue(':basket_seen', count($items), PDO::PARAM_INT);
        $found->bindValue(':sheet_id', $sheetId, PDO::PARAM_INT);
        $found->bindValue(':sheet_id2', $sheetId, PDO::PARAM_INT);
        $this->Db->execute($found);
        $count = $this->Db->prepare('SELECT COUNT(DISTINCT item_index) FROM custom_order_sheet_items WHERE team = :team AND procurement_id = :procurement_id');
        $count->bindValue(':team', $team, PDO::PARAM_INT);
        $count->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($count);
        return array('collected' => (int) $count->fetchColumn(), 'total' => count($items));
    }

    /**
     * Whether an article number read from a scan is in the text of a basket row. OCR misreads a letter now and then
     * ("EPA029397-100U" for "HPA029397-100U"), so a few differing characters are tolerated, fewer for short numbers.
     */
    private static function articleMatches(string $itemText, string $token): bool
    {
        if (str_contains($itemText, $token)) {
            return true;
        }
        $length = strlen($token);
        $tolerance = $length <= 6 ? 0 : ($length <= 9 ? 1 : 2);
        if ($tolerance === 0) {
            return false;
        }
        for ($window = $length - 1; $window <= $length + 1; $window++) {
            for ($start = 0; $start + $window <= strlen($itemText); $start++) {
                if (levenshtein($token, substr($itemText, $start, $window)) <= $tolerance) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Whether a line of the sheet shares a long run of characters with the text of a basket row: the description of
     * an item is printed on both. At least twelve letters and digits in a row, so a few common words do not count.
     *
     * @param list<string> $sheetLines the lines of the sheet, reduced to upper case letters and digits
     */
    private static function descriptionMatches(string $itemText, array $sheetLines): bool
    {
        $item = (string) preg_replace('/[^A-Z0-9]/', '', $itemText);
        $itemLength = strlen($item);
        foreach ($sheetLines as $line) {
            $lineLength = strlen($line);
            // longest common run of characters, with a rolling row
            $previous = array_fill(0, $itemLength + 1, 0);
            for ($i = 1; $i <= $lineLength; $i++) {
                $current = array(0);
                for ($j = 1; $j <= $itemLength; $j++) {
                    $current[$j] = $line[$i - 1] === $item[$j - 1] ? $previous[$j - 1] + 1 : 0;
                    if ($current[$j] >= 12) {
                        return true;
                    }
                }
                $previous = $current;
            }
        }
        return false;
    }

    private function markCollected(int $orderId): int
    {
        $req = $this->Db->prepare("UPDATE custom_orders SET status = 'collected', status_changed_at = NOW()
            WHERE id = :id AND team = :team AND status = 'ordered'");
        $req->bindValue(':id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':team', (int) $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->rowCount();
    }

    private function attachedUploadId(int $orderId, string $realName, int $size): ?int
    {
        $req = $this->Db->prepare('SELECT id FROM custom_order_uploads
            WHERE order_id = :order_id AND real_name = :real_name AND filesize = :filesize ORDER BY id LIMIT 1');
        $req->bindValue(':order_id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':real_name', $realName);
        $req->bindValue(':filesize', $size, PDO::PARAM_INT);
        $this->Db->execute($req);
        $id = $req->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /**
     * Matches the sheets that were recorded before the confirmation's item list could be read (or when it had another
     * number of items) against it again, reading each stored sheet once more. Called on a schedule.
     *
     * @return int how many sheets were looked at again
     */
    public function rescan(): int
    {
        $team = (int) $this->requester->userData['team'];
        $req = $this->Db->prepare('SELECT id, procurement_id, sheet_name, filesize, basket_seen FROM custom_order_sheets WHERE team = :team');
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $done = 0;
        foreach ($req->fetchAll(PDO::FETCH_ASSOC) as $sheet) {
            $procurementId = (string) $sheet['procurement_id'];
            $basketSize = $this->basketSize($team, $procurementId);
            if ($basketSize === 0 || (int) ($sheet['basket_seen'] ?? -1) === $basketSize) {
                continue;
            }
            $file = $this->storedFile($team, $procurementId, (string) $sheet['sheet_name'], (int) $sheet['filesize']);
            if ($file === null) {
                continue;
            }
            $tmp = tempnam(sys_get_temp_dir(), 'sheet_');
            if ($tmp === false) {
                continue;
            }
            try {
                file_put_contents($tmp, Storage::from($file['storage'])->getStorage()->getFs()->read($file['long_name']));
                $this->recordCollectedItems($procurementId, ScanReader::textFromPdf($tmp), (string) $sheet['sheet_name'], (int) $sheet['id']);
                $done++;
            } catch (Throwable) {
                // an unreadable stored file is left for the next run
            } finally {
                @unlink($tmp);
            }
        }
        return $done;
    }

    private function basketSize(int $team, string $procurementId): int
    {
        $req = $this->Db->prepare("SELECT u.extracted_text FROM custom_order_uploads AS u
            INNER JOIN custom_orders AS o ON o.id = u.order_id
            WHERE o.team = :team AND (u.procurement_id = :procurement_id OR o.procurement_id = :procurement_id)
                AND u.extracted_text LIKE '%Warenkorb%' ORDER BY u.id DESC LIMIT 1");
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($req);
        $text = $req->fetchColumn();
        return $text === false ? 0 : count(ScanReader::basketItems((string) $text));
    }

    /** @return array{long_name: string, storage: int}|null */
    private function storedFile(int $team, string $procurementId, string $name, int $size): ?array
    {
        $req = $this->Db->prepare('SELECT up.long_name, up.storage FROM custom_order_uploads AS up
            INNER JOIN custom_orders AS o ON o.id = up.order_id
            WHERE o.team = :team AND o.procurement_id = :procurement_id AND up.real_name = :real_name AND up.filesize = :filesize
            ORDER BY up.id LIMIT 1');
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        $req->bindValue(':real_name', $name);
        $req->bindValue(':filesize', $size, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $req->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : array('long_name' => (string) $row['long_name'], 'storage' => (int) $row['storage']);
    }

    /** Records the sheet (once per procurement, name and size) and returns its id. */
    private function saveSheet(int $team, string $procurementId, string $realName, int $size, ?int $uploadId): int
    {
        $req = $this->Db->prepare('INSERT INTO custom_order_sheets (team, procurement_id, sheet_name, filesize, upload_id)
            VALUES (:team, :procurement_id, :sheet_name, :filesize, :upload_id)
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), upload_id = COALESCE(upload_id, VALUES(upload_id))');
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        $req->bindValue(':sheet_name', $realName);
        $req->bindValue(':filesize', $size, PDO::PARAM_INT);
        $req->bindValue(':upload_id', $uploadId, $uploadId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $this->Db->lastInsertId();
    }
}
