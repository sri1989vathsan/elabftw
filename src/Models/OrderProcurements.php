<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\ScanReader;
use Override;
use PDO;

use function array_column;
use function array_map;
use function count;
use function implode;
use function max;
use function min;
use function preg_match;
use function trim;

/**
 * The "Order Status" overview for the team: one row per procurement (the orders that share a procurement ID) with
 * its order numbers, order date, requesters, the orders themselves and how many of its items were collected, as
 * recognised on the collection sheets (see OrderSheets). Searchable and filterable by the order date.
 */
final class OrderProcurements extends AbstractRest
{
    private const int DEFAULT_LIMIT = 25;

    private const int MAX_LIMIT = 100;

    public function __construct(private Users $requester, private ?int $id = null)
    {
        parent::__construct();
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/order_status/';
    }

    /** @return array{total: int, items: list<array<string, mixed>>} */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();
        $team = (int) $this->requester->userData['team'];

        $conditions = array('o.team = :team', "o.procurement_id IS NOT NULL", "o.procurement_id <> ''", "o.status NOT IN ('my_reference')");
        $bind = array(':team' => array($team, PDO::PARAM_INT));

        // "mine" keeps only the orders the viewer requested (a procurement with none of theirs is left out)
        $mine = $query->getString('owner') === 'mine';
        $viewer = (int) $this->requester->userid;
        if ($mine) {
            $conditions[] = 'o.userid = :viewer';
            $bind[':viewer'] = array($viewer, PDO::PARAM_INT);
        }
        $search = trim($query->getString('q'));
        if ($search !== '') {
            $conditions[] = "(o.procurement_id LIKE :q OR o.order_number LIKE :q OR o.title LIKE :q
                OR CONCAT(u.firstname, ' ', u.lastname) LIKE :q)";
            $bind[':q'] = array('%' . $search . '%', PDO::PARAM_STR);
        }
        // the order date, or the day the order was made in eLabFTW when the confirmation had none
        $dateFrom = $this->validDate($query->getString('date_from'));
        if ($dateFrom !== null) {
            $conditions[] = 'COALESCE(o.order_date, DATE(o.created_at)) >= :date_from';
            $bind[':date_from'] = array($dateFrom, PDO::PARAM_STR);
        }
        $dateTo = $this->validDate($query->getString('date_to'));
        if ($dateTo !== null) {
            $conditions[] = 'COALESCE(o.order_date, DATE(o.created_at)) <= :date_to';
            $bind[':date_to'] = array($dateTo, PDO::PARAM_STR);
        }
        $where = implode(' AND ', $conditions);
        $from = 'FROM custom_orders AS o INNER JOIN users AS u ON u.userid = o.userid';

        $countReq = $this->Db->prepare("SELECT COUNT(DISTINCT o.procurement_id) {$from} WHERE {$where}");
        $this->bindAll($countReq, $bind);
        $this->Db->execute($countReq);
        $total = (int) $countReq->fetchColumn();

        $limit = min(self::MAX_LIMIT, max(1, $query->getInt('limit', self::DEFAULT_LIMIT)));
        $offset = max(0, $query->getInt('offset'));
        $sql = "SELECT o.procurement_id,
                COUNT(*) AS order_count,
                GROUP_CONCAT(DISTINCT NULLIF(o.order_number, '') ORDER BY o.order_number SEPARATOR ', ') AS order_numbers,
                MAX(COALESCE(o.order_date, DATE(o.created_at))) AS order_date,
                GROUP_CONCAT(DISTINCT CONCAT(u.firstname, ' ', u.lastname) ORDER BY u.firstname SEPARATOR ', ') AS requesters
            {$from} WHERE {$where}
            GROUP BY o.procurement_id
            ORDER BY MAX(COALESCE(o.order_date, DATE(o.created_at))) DESC, MAX(o.id) DESC
            LIMIT :limit OFFSET :offset";
        $req = $this->Db->prepare($sql);
        $this->bindAll($req, $bind);
        $req->bindValue(':limit', $limit, PDO::PARAM_INT);
        $req->bindValue(':offset', $offset, PDO::PARAM_INT);
        $this->Db->execute($req);
        $rows = $req->fetchAll(PDO::FETCH_ASSOC);

        $items = array();
        foreach ($rows as $row) {
            $procurementId = (string) $row['procurement_id'];
            $orders = $this->ordersOf($team, $procurementId, $mine ? $viewer : null);
            $progress = $this->progressOf($team, $procurementId);
            $detail = $this->itemsAndSheets($team, $procurementId);
            $items[] = array(
                'procurement_id' => $procurementId,
                'order_numbers' => $row['order_numbers'] ?? '',
                'order_date' => $row['order_date'],
                'requesters' => $row['requesters'],
                'order_count' => (int) $row['order_count'],
                'orders' => $orders,
                'items_collected' => $progress['collected'],
                'items_total' => $progress['total'],
                'last_collected_at' => $progress['last_collected_at'],
                'items' => $detail['items'],
                'sheets' => $detail['sheets'],
            );
        }
        return array('total' => $total, 'items' => $items);
    }

    #[Override]
    public function readOne(): array
    {
        return $this->readAll();
    }

    /** @return list<array{id: int, title: string, status: string, requester: string}> */
    private function ordersOf(int $team, string $procurementId, ?int $onlyUserid = null): array
    {
        $req = $this->Db->prepare("SELECT o.id, o.title, o.status, CONCAT(u.firstname, ' ', u.lastname) AS requester
            FROM custom_orders AS o INNER JOIN users AS u ON u.userid = o.userid
            WHERE o.team = :team AND o.procurement_id = :procurement_id AND o.status <> 'my_reference'"
            . ($onlyUserid === null ? '' : ' AND o.userid = :only_userid') . ' ORDER BY o.id');
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':procurement_id', $procurementId);
        if ($onlyUserid !== null) {
            $req->bindValue(':only_userid', $onlyUserid, PDO::PARAM_INT);
        }
        $this->Db->execute($req);
        return array_map(static fn (array $order): array => array(
            'id' => (int) $order['id'],
            'title' => (string) $order['title'],
            'status' => (string) $order['status'],
            'requester' => (string) $order['requester'],
        ), $req->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * How many items of the procurement are collected, out of the rows of the basket in its confirmation PDF (null
     * totals when no confirmation with a basket is attached).
     *
     * @return array{collected: int, total: int|null, last_collected_at: string|null}
     */
    private function progressOf(int $team, string $procurementId): array
    {
        $count = $this->Db->prepare('SELECT COUNT(DISTINCT item_index) AS collected, MAX(created_at) AS last_at FROM custom_order_sheet_items
            WHERE team = :team AND procurement_id = :procurement_id');
        $count->bindValue(':team', $team, PDO::PARAM_INT);
        $count->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($count);
        $counted = $count->fetch(PDO::FETCH_ASSOC);

        $confirmation = $this->Db->prepare("SELECT u.extracted_text FROM custom_order_uploads AS u
            INNER JOIN custom_orders AS o ON o.id = u.order_id
            WHERE o.team = :team AND (u.procurement_id = :procurement_id OR o.procurement_id = :procurement_id)
                AND u.extracted_text LIKE '%Warenkorb%' ORDER BY u.id DESC LIMIT 1");
        $confirmation->bindValue(':team', $team, PDO::PARAM_INT);
        $confirmation->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($confirmation);
        $text = $confirmation->fetchColumn();
        $total = $text === false ? 0 : count(ScanReader::basketItems((string) $text));
        return array(
            'collected' => $total > 0 ? min((int) ($counted['collected'] ?? 0), $total) : (int) ($counted['collected'] ?? 0),
            'total' => $total > 0 ? $total : null,
            'last_collected_at' => $counted['last_at'] ?? null,
        );
    }

    /**
     * Every item of the procurement's basket with the sheets it was collected on, and every signed sheet with the
     * items found on it.
     *
     * @return array{items: list<array{index: int, label: string, sheets: list<string>}>, sheets: list<array<string, mixed>>}
     */
    private function itemsAndSheets(int $team, string $procurementId): array
    {
        $confirmation = $this->Db->prepare("SELECT u.extracted_text FROM custom_order_uploads AS u
            INNER JOIN custom_orders AS o ON o.id = u.order_id
            WHERE o.team = :team AND (u.procurement_id = :procurement_id OR o.procurement_id = :procurement_id)
                AND u.extracted_text LIKE '%Warenkorb%' ORDER BY u.id DESC LIMIT 1");
        $confirmation->bindValue(':team', $team, PDO::PARAM_INT);
        $confirmation->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($confirmation);
        $text = $confirmation->fetchColumn();
        $basket = $text === false ? array() : ScanReader::basketRows((string) $text);

        $sheetsReq = $this->Db->prepare('SELECT s.id, s.sheet_name, s.filesize, s.created_at, s.items_found
            FROM custom_order_sheets AS s
            WHERE s.team = :team AND s.procurement_id = :procurement_id ORDER BY s.created_at, s.id');
        $sheetsReq->bindValue(':team', $team, PDO::PARAM_INT);
        $sheetsReq->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($sheetsReq);
        $sheetRows = $sheetsReq->fetchAll(PDO::FETCH_ASSOC);

        $linkReq = $this->Db->prepare('SELECT sheet_id, item_index FROM custom_order_sheet_items
            WHERE team = :team AND procurement_id = :procurement_id ORDER BY item_index');
        $linkReq->bindValue(':team', $team, PDO::PARAM_INT);
        $linkReq->bindValue(':procurement_id', $procurementId);
        $this->Db->execute($linkReq);
        $itemsOfSheet = array();
        $sheetsOfItem = array();
        $names = array_column($sheetRows, 'sheet_name', 'id');
        foreach ($linkReq->fetchAll(PDO::FETCH_ASSOC) as $link) {
            $itemsOfSheet[(int) $link['sheet_id']][] = (int) $link['item_index'];
            if (isset($names[$link['sheet_id']])) {
                $sheetsOfItem[(int) $link['item_index']][] = (string) $names[$link['sheet_id']];
            }
        }

        $items = array();
        foreach ($basket as $index => $row) {
            $items[] = array('index' => $index, 'label' => $row['label'], 'sheets' => $sheetsOfItem[$index] ?? array());
        }
        // the file of a sheet is looked up on the orders that still exist: deleting one order must not break the link
        $fileReq = $this->Db->prepare('SELECT up.long_name, up.storage FROM custom_order_uploads AS up
            INNER JOIN custom_orders AS o ON o.id = up.order_id
            WHERE o.team = :team AND o.procurement_id = :procurement_id AND up.real_name = :real_name AND up.filesize = :filesize
            ORDER BY up.id LIMIT 1');
        $sheets = array();
        foreach ($sheetRows as $sheet) {
            $fileReq->bindValue(':team', $team, PDO::PARAM_INT);
            $fileReq->bindValue(':procurement_id', $procurementId);
            $fileReq->bindValue(':real_name', (string) $sheet['sheet_name']);
            $fileReq->bindValue(':filesize', (int) $sheet['filesize'], PDO::PARAM_INT);
            $this->Db->execute($fileReq);
            $file = $fileReq->fetch(PDO::FETCH_ASSOC);
            $found = $itemsOfSheet[(int) $sheet['id']] ?? array();
            $sheets[] = array(
                'id' => (int) $sheet['id'],
                'name' => (string) $sheet['sheet_name'],
                'collected_at' => $sheet['created_at'],
                'download' => $file === false ? null : array(
                    'long_name' => (string) $file['long_name'],
                    'storage' => (int) $file['storage'],
                ),
                'items' => array_map(static fn (int $i): string => $basket[$i]['label'] ?? '#' . ($i + 1), $found),
            );
        }
        return array('items' => $items, 'sheets' => $sheets);
    }

    private function validDate(string $value): ?string
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : null;
    }

    /** @param array<string, array{0: mixed, 1: int}> $bind */
    private function bindAll(\PDOStatement $statement, array $bind): void
    {
        foreach ($bind as $name => [$value, $type]) {
            $statement->bindValue($name, $value, $type);
        }
    }
}
