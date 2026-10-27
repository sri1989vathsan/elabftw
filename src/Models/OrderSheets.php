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
use Elabftw\Services\ScanReader;
use Override;
use PDO;
use Symfony\Component\HttpFoundation\File\UploadedFile;

use function array_key_exists;
use function count;
use function mb_strtolower;
use function pathinfo;
use function levenshtein;
use function sprintf;
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
            $title = $owned[0]['title'] . (count($owned) > 1 ? sprintf(' (+%d)', count($owned) - 1) : '');
            (new OrderChanged(
                new Users($ownerId, $team),
                $this->requester,
                $owned[0]['id'],
                $title,
                'received',
                $progress === null ? null : sprintf('%d/%d', $progress['collected'], $progress['total']),
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
        foreach ($items as $index => $itemText) {
            foreach ($tokens as $token) {
                if (self::articleMatches($itemText, $token)) {
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
        $found = $this->Db->prepare('UPDATE custom_order_sheets SET items_found = (SELECT COUNT(DISTINCT item_index) FROM custom_order_sheet_items WHERE sheet_id = :sheet_id) WHERE id = :sheet_id2');
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
