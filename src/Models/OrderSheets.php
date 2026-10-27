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
use function sprintf;

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
     * @return array{file: string, procurement_id: string|null, orders: list<array{id: int, title: string}>, notified: int, collected?: int, status: string}
     */
    public function process(UploadedFile $file): array
    {
        $realName = $file->getClientOriginalName();
        $result = array('file' => $realName, 'procurement_id' => null, 'orders' => array(), 'notified' => 0, 'status' => 'unreadable');
        if (mb_strtolower(pathinfo($realName, PATHINFO_EXTENSION)) !== 'pdf') {
            $result['status'] = 'not_pdf';
            return $result;
        }
        $procurementId = ScanReader::procurementIdFromPdf($file->getPathname());
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

        $byOwner = array();
        $collected = 0;
        foreach ($orders as $order) {
            $orderId = (int) $order['id'];
            // dropping the same sheet twice must not attach it twice
            if (!$this->alreadyAttached($orderId, $realName, (int) $file->getSize())) {
                (new OrderUploads($this->requester, new Orders($this->requester, $orderId)))->postAction(
                    Action::Create,
                    array('file' => $file, 'real_name' => $realName, 'silent' => true),
                );
            }
            // the goods are here: the order becomes "collected" (pinned and cancelled orders keep their status)
            $collected += $this->markCollected($orderId);
            $result['orders'][] = array('id' => $orderId, 'title' => (string) $order['title']);
            $byOwner[(int) $order['userid']][] = array('id' => $orderId, 'title' => (string) $order['title']);
        }
        // one notification per person (not per order); nobody is told about their own drop
        foreach ($byOwner as $ownerId => $owned) {
            if ($ownerId === (int) $this->requester->userid) {
                continue;
            }
            $title = $owned[0]['title'] . (count($owned) > 1 ? sprintf(' (+%d)', count($owned) - 1) : '');
            (new OrderChanged(new Users($ownerId, $team), $this->requester, $owned[0]['id'], $title, 'received'))->create();
            $result['notified']++;
        }
        $result['status'] = 'attached';
        $result['collected'] = $collected;
        return $result;
    }

    private function markCollected(int $orderId): int
    {
        $req = $this->Db->prepare("UPDATE custom_orders SET status = 'collected', status_changed_at = NOW()
            WHERE id = :id AND team = :team AND status NOT IN ('collected', 'cancelled', 'pinned_all', 'my_reference')");
        $req->bindValue(':id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':team', (int) $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->rowCount();
    }

    private function alreadyAttached(int $orderId, string $realName, int $size): bool
    {
        $req = $this->Db->prepare('SELECT COUNT(*) FROM custom_order_uploads
            WHERE order_id = :order_id AND real_name = :real_name AND filesize = :filesize');
        $req->bindValue(':order_id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':real_name', $realName);
        $req->bindValue(':filesize', $size, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $req->fetchColumn() > 0;
    }
}
