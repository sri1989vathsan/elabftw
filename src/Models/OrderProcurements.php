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

use function array_map;
use function array_unique;
use function array_values;
use function count;
use function implode;
use function max;
use function min;
use function preg_match;
use function sprintf;
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
        // one person's orders (the whole tab is open to the team, so this is a convenience, not a privilege)
        $filterUser = $query->getInt('userid');
        if ($filterUser > 0 && !$mine) {
            $conditions[] = 'o.userid = :filter_user';
            $bind[':filter_user'] = array($filterUser, PDO::PARAM_INT);
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

        // Everything the rows below need is read for the whole page at once (a handful of queries), not once per row.
        $procurementIds = array_values(array_map(static fn(array $row): string => (string) $row['procurement_id'], $rows));
        $ordersOf = $this->ordersOf($team, $procurementIds, $mine ? $viewer : ($filterUser > 0 ? $filterUser : null));
        $baskets = $this->basketsOf($team, $procurementIds);
        $collectedOf = $this->collectedOf($team, $procurementIds);
        $detailOf = $this->itemsAndSheets($team, $procurementIds, $baskets);

        $items = array();
        foreach ($rows as $row) {
            $procurementId = (string) $row['procurement_id'];
            $basketSize = count($baskets[$procurementId] ?? array());
            $collected = $collectedOf[$procurementId]['collected'] ?? 0;
            $detail = $detailOf[$procurementId] ?? array('items' => array(), 'sheets' => array());
            $items[] = array(
                'procurement_id' => $procurementId,
                'order_numbers' => $row['order_numbers'] ?? '',
                'order_date' => $row['order_date'],
                'requesters' => $row['requesters'],
                'order_count' => (int) $row['order_count'],
                'orders' => $ordersOf[$procurementId] ?? array(),
                'items_collected' => $basketSize > 0 ? min($collected, $basketSize) : $collected,
                'items_total' => $basketSize > 0 ? $basketSize : null,
                'last_collected_at' => $collectedOf[$procurementId]['last_at'] ?? null,
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

    /**
     * Runs a query for the procurements of one page. $body is everything after the WITH: it can use the list
     * p(pid) -- the page's procurement IDs, as the page spells them -- and :team. The IDs are matched to the tables
     * in SQL (p.pid = table.procurement_id), so they compare exactly as the one-procurement-at-a-time queries
     * used to (same collation), and each row comes back with the page's own spelling of its ID.
     *
     * @param list<string> $procurementIds
     * @param array<string, array{0: mixed, 1: int}> $extraBind
     * @return list<array<string, mixed>>
     */
    private function queryByProcurements(string $body, array $procurementIds, int $team, array $extraBind = array()): array
    {
        if ($procurementIds === array()) {
            return array();
        }
        $selects = array();
        $bind = array(':team' => array($team, PDO::PARAM_INT)) + $extraBind;
        foreach ($procurementIds as $i => $procurementId) {
            $selects[] = $i === 0 ? 'SELECT :pid0 AS pid' : sprintf('SELECT :pid%d', $i);
            $bind[sprintf(':pid%d', $i)] = array($procurementId, PDO::PARAM_STR);
        }
        $req = $this->Db->prepare('WITH p AS (' . implode(' UNION ALL ', $selects) . ') ' . $body);
        $this->bindAll($req, $bind);
        $this->Db->execute($req);
        return array_values($req->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * The orders of each procurement.
     *
     * @param list<string> $procurementIds
     * @return array<string, list<array{id: int, title: string, status: string, requester: string}>>
     */
    private function ordersOf(int $team, array $procurementIds, ?int $onlyUserid = null): array
    {
        $rows = $this->queryByProcurements(
            "SELECT p.pid, o.id, o.title, o.status, CONCAT(u.firstname, ' ', u.lastname) AS requester
            FROM p
            INNER JOIN custom_orders AS o ON o.team = :team AND o.procurement_id = p.pid AND o.status <> 'my_reference'"
                . ($onlyUserid === null ? '' : ' AND o.userid = :only_userid') . '
            INNER JOIN users AS u ON u.userid = o.userid
            ORDER BY o.id',
            $procurementIds,
            $team,
            $onlyUserid === null ? array() : array(':only_userid' => array($onlyUserid, PDO::PARAM_INT)),
        );
        $orders = array();
        foreach ($rows as $order) {
            $orders[(string) $order['pid']][] = array(
                'id' => (int) $order['id'],
                'title' => (string) $order['title'],
                'status' => (string) $order['status'],
                'requester' => (string) $order['requester'],
            );
        }
        return $orders;
    }

    /**
     * The rows of the basket in the latest confirmation of each procurement (no entry when none is attached). The
     * confirmation is the newest upload of the procurement's orders whose text holds "Warenkorb": an upload tagged
     * with the procurement, or one attached to an order of it -- the two sides of the OR the one-procurement query
     * used, as a UNION so each can use its index. The texts are large: only the winning upload ids are looked for
     * first, then each distinct text is read and parsed once, however many procurements share it.
     *
     * @param list<string> $procurementIds
     * @return array<string, list<array{key: string, label: string}>>
     */
    private function basketsOf(int $team, array $procurementIds): array
    {
        $latest = $this->queryByProcurements(
            "SELECT m.pid, MAX(m.upload_id) AS upload_id FROM (
                SELECT p.pid AS pid, u.id AS upload_id FROM p
                INNER JOIN custom_order_uploads AS u ON u.procurement_id = p.pid
                INNER JOIN custom_orders AS o ON o.id = u.order_id AND o.team = :team
                WHERE u.extracted_text LIKE '%Warenkorb%'
                UNION ALL
                SELECT p.pid, u.id FROM p
                INNER JOIN custom_orders AS o ON o.team = :team AND o.procurement_id = p.pid
                INNER JOIN custom_order_uploads AS u ON u.order_id = o.id
                WHERE u.extracted_text LIKE '%Warenkorb%'
            ) AS m GROUP BY m.pid",
            $procurementIds,
            $team,
        );
        if ($latest === array()) {
            return array();
        }
        $uploadIds = array_values(array_unique(array_map(static fn(array $row): int => (int) $row['upload_id'], $latest)));
        $req = $this->Db->prepare(sprintf(
            'SELECT id, extracted_text FROM custom_order_uploads WHERE id IN (%s)',
            implode(',', $uploadIds),
        ));
        $this->Db->execute($req);
        $basketOfUpload = array();
        foreach ($req->fetchAll(PDO::FETCH_ASSOC) as $upload) {
            $basketOfUpload[(int) $upload['id']] = ScanReader::basketRows((string) $upload['extracted_text']);
        }
        $baskets = array();
        foreach ($latest as $row) {
            $baskets[(string) $row['pid']] = $basketOfUpload[(int) $row['upload_id']] ?? array();
        }
        return $baskets;
    }

    /**
     * How many distinct items of each procurement were collected on a sheet, and when the last one was (no entry
     * for a procurement with none).
     *
     * @param list<string> $procurementIds
     * @return array<string, array{collected: int, last_at: string|null}>
     */
    private function collectedOf(int $team, array $procurementIds): array
    {
        $rows = $this->queryByProcurements(
            'SELECT p.pid, COUNT(DISTINCT i.item_index) AS collected, MAX(i.created_at) AS last_at
            FROM p
            INNER JOIN custom_order_sheet_items AS i ON i.team = :team AND i.procurement_id = p.pid
            GROUP BY p.pid',
            $procurementIds,
            $team,
        );
        $collected = array();
        foreach ($rows as $row) {
            $collected[(string) $row['pid']] = array('collected' => (int) $row['collected'], 'last_at' => $row['last_at']);
        }
        return $collected;
    }

    /**
     * For each procurement: every item of its basket with the sheets it was collected on, and every signed sheet
     * with the items found on it.
     *
     * @param list<string> $procurementIds
     * @param array<string, list<array{key: string, label: string}>> $baskets from basketsOf()
     * @return array<string, array{items: list<array{index: int, label: string, sheets: list<string>}>, sheets: list<array<string, mixed>>}>
     */
    private function itemsAndSheets(int $team, array $procurementIds, array $baskets): array
    {
        $sheetRows = $this->queryByProcurements(
            'SELECT p.pid, s.id, s.sheet_name, s.filesize, s.created_at, s.items_found
            FROM p
            INNER JOIN custom_order_sheets AS s ON s.team = :team AND s.procurement_id = p.pid
            ORDER BY s.created_at, s.id',
            $procurementIds,
            $team,
        );
        // (item_index, sheet_id) is the order of the table's unique index, i.e. the order the one-procurement query returned
        $linkRows = $this->queryByProcurements(
            'SELECT p.pid, i.sheet_id, i.item_index
            FROM p
            INNER JOIN custom_order_sheet_items AS i ON i.team = :team AND i.procurement_id = p.pid
            ORDER BY i.item_index, i.sheet_id',
            $procurementIds,
            $team,
        );
        // The file of a sheet is looked up on the orders that still exist: deleting one order must not break the link.
        // The sheet table's columns and the upload table's differ in collation (unicode_ci / 0900_ai_ci), which MySQL
        // refuses to compare against each other; the name is compared the way the one-sheet query did, as the
        // upload's own column compares to a given string.
        $fileRows = $this->queryByProcurements(
            'SELECT s.id AS sheet_id, up.long_name, up.storage
            FROM p
            INNER JOIN custom_order_sheets AS s ON s.team = :team AND s.procurement_id = p.pid
            INNER JOIN custom_orders AS o ON o.team = :team AND o.procurement_id = p.pid
            INNER JOIN custom_order_uploads AS up ON up.order_id = o.id
                AND up.real_name = s.sheet_name COLLATE utf8mb4_0900_ai_ci AND up.filesize = s.filesize
            ORDER BY up.id',
            $procurementIds,
            $team,
        );
        $fileOfSheet = array();
        foreach ($fileRows as $file) {
            $fileOfSheet[(int) $file['sheet_id']] ??= $file; // the first (lowest id) upload of the sheet's name and size
        }

        $sheetsOf = array();
        $namesOf = array();
        foreach ($sheetRows as $sheet) {
            $sheetsOf[(string) $sheet['pid']][] = $sheet;
            $namesOf[(string) $sheet['pid']][$sheet['id']] = $sheet['sheet_name'];
        }
        $itemsOfSheet = array();
        $sheetsOfItem = array();
        foreach ($linkRows as $link) {
            $pid = (string) $link['pid'];
            $itemsOfSheet[$pid][(int) $link['sheet_id']][] = (int) $link['item_index'];
            if (isset($namesOf[$pid][$link['sheet_id']])) {
                $sheetsOfItem[$pid][(int) $link['item_index']][] = (string) $namesOf[$pid][$link['sheet_id']];
            }
        }

        $detail = array();
        foreach ($procurementIds as $pid) {
            $basket = $baskets[$pid] ?? array();
            $items = array();
            foreach ($basket as $index => $row) {
                $items[] = array('index' => $index, 'label' => $row['label'], 'sheets' => $sheetsOfItem[$pid][$index] ?? array());
            }
            $sheets = array();
            foreach ($sheetsOf[$pid] ?? array() as $sheet) {
                $file = $fileOfSheet[(int) $sheet['id']] ?? null;
                $found = $itemsOfSheet[$pid][(int) $sheet['id']] ?? array();
                $sheets[] = array(
                    'id' => (int) $sheet['id'],
                    'name' => (string) $sheet['sheet_name'],
                    'collected_at' => $sheet['created_at'],
                    'download' => $file === null ? null : array(
                        'long_name' => (string) $file['long_name'],
                        'storage' => (int) $file['storage'],
                    ),
                    'items' => array_map(static fn(int $i): string => $basket[$i]['label'] ?? '#' . ($i + 1), $found),
                );
            }
            $detail[$pid] = array('items' => $items, 'sheets' => $sheets);
        }
        return $detail;
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
