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
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_fill;
use function array_key_exists;
use function array_map;
use function array_unique;
use function array_values;
use function count;
use function implode;
use function in_array;
use function is_array;
use function json_decode;
use function mb_strlen;
use function trim;

use const JSON_THROW_ON_ERROR;

/**
 * A team-scoped "please order this" board, replacing an external Trello
 * board. Unlike the native procurement_requests table, an order does not
 * require an existing procurable resource -- linked items are optional,
 * and an order can link any number of Resources database items, not just
 * ones marked procurable.
 */
final class Orders extends AbstractRest
{
    use SetIdTrait;

    private const array STATUSES = array('requested', 'ordered', 'received', 'cancelled');

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/orders/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $title = $this->getTitle($reqBody['title'] ?? '');
        $notes = $this->getNotes($reqBody['notes'] ?? null);
        $itemIds = $this->getItemIds($reqBody['item_ids'] ?? null);
        $sql = 'INSERT INTO custom_orders (team, userid, title, notes)
            VALUES (:team, :userid, :title, :notes)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $this->Db->execute($req);
        $orderId = (int) $this->Db->lastInsertId();

        if (!empty($itemIds)) {
            $this->setId($orderId);
            $this->replaceItems($itemIds);
        }

        return $orderId;
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();

        // default GROUP_CONCAT cap (1024 bytes) would silently truncate
        // extracted PDF text well before it's useful for search
        $this->Db->q('SET SESSION group_concat_max_len = 1000000');

        $conditions = array('o.team = :team');
        $bind = array(':team' => array($this->Users->team, PDO::PARAM_INT));

        $status = $query->getString('status');
        if ($status === 'archived') {
            $conditions[] = 'o.archived = 1';
        } elseif (in_array($status, self::STATUSES, true)) {
            $conditions[] = 'o.archived = 0';
            $conditions[] = 'o.status = :status';
            $bind[':status'] = array($status, PDO::PARAM_STR);
        }

        // admin-only "filter by a specific person" -- enforced here, not
        // just hidden in the UI, so a non-admin can't just add the param
        if ($this->Users->isAdmin) {
            $userid = $query->getInt('userid');
            if ($userid > 0) {
                $conditions[] = 'o.userid = :userid';
                $bind[':userid'] = array($userid, PDO::PARAM_INT);
            }
        }

        $limit = $query->getInt('limit') ?: 0;
        $offset = max(0, $query->getInt('offset'));
        // ask for one extra row so the frontend can tell whether there's a
        // next page without a separate COUNT query
        $limitSql = $limit > 0 ? sprintf(' LIMIT %d OFFSET %d', $limit + 1, $offset) : '';

        $sql = 'SELECT o.id, o.title, o.notes, o.status, o.archived, o.created_at, o.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT("id", oi_item.id, "title", oi_item.title))
                    FROM custom_order_items AS oi
                    INNER JOIN items AS oi_item ON oi_item.id = oi.item_id
                    WHERE oi.order_id = o.id
                ), JSON_ARRAY()) AS items,
                COALESCE((
                    SELECT GROUP_CONCAT(oi_item2.title SEPARATOR " ")
                    FROM custom_order_items AS oi2
                    INNER JOIN items AS oi_item2 ON oi_item2.id = oi2.item_id
                    WHERE oi2.order_id = o.id
                ), "") AS items_text,
                COALESCE((
                    SELECT GROUP_CONCAT(comment.body SEPARATOR " ")
                    FROM custom_order_comments AS comment
                    WHERE comment.order_id = o.id
                ), "") AS comments_text,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT(
                        "id", upload.id,
                        "real_name", upload.real_name,
                        "long_name", upload.long_name,
                        "storage", upload.storage,
                        "filesize", upload.filesize,
                        "has_extracted_text", (upload.extracted_text IS NOT NULL),
                        "created_at", upload.created_at,
                        "userid", upload.userid,
                        "author_fullname", (SELECT CONCAT(u2.firstname, " ", u2.lastname) FROM users AS u2 WHERE u2.userid = upload.userid)
                    ))
                    FROM custom_order_uploads AS upload
                    WHERE upload.order_id = o.id
                ), JSON_ARRAY()) AS uploads,
                COALESCE((
                    SELECT GROUP_CONCAT(CONCAT(upload2.real_name, " ", COALESCE(upload2.extracted_text, "")) SEPARATOR " ")
                    FROM custom_order_uploads AS upload2
                    WHERE upload2.order_id = o.id
                ), "") AS attachments_text
            FROM custom_orders AS o
            LEFT JOIN users AS author ON author.userid = o.userid
            WHERE ' . implode(' AND ', $conditions) . "
            ORDER BY o.created_at DESC{$limitSql}";
        $req = $this->Db->prepare($sql);
        foreach ($bind as $key => $valueAndType) {
            [$value, $type] = $valueAndType;
            $req->bindValue($key, $value, $type);
        }
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$order) {
            $order['id'] = (int) $order['id'];
            $order['userid'] = (int) $order['userid'];
            $order['archived'] = (bool) $order['archived'];
            $order['items'] = json_decode((string) $order['items'], true, 512, JSON_THROW_ON_ERROR);
            $uploads = json_decode((string) $order['uploads'], true, 512, JSON_THROW_ON_ERROR);
            foreach ($uploads as &$upload) {
                $upload['id'] = (int) $upload['id'];
                $upload['storage'] = (int) $upload['storage'];
                $upload['userid'] = (int) $upload['userid'];
                $upload['filesize'] = $upload['filesize'] !== null ? (int) $upload['filesize'] : null;
                $upload['has_extracted_text'] = (bool) $upload['has_extracted_text'];
            }
            unset($upload);
            $order['uploads'] = $uploads;
        }
        unset($order);

        return $result;
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $order) {
            if ($order['id'] === $this->id) {
                return $order;
            }
        }
        throw new ResourceNotFoundException();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $order = $this->readOne();
        $isOwner = $order['userid'] === $this->Users->userid;
        if (array_key_exists('status', $params)) {
            $this->updateStatus((string) $params['status']);
        }
        if (array_key_exists('archived', $params)) {
            $this->updateArchived((bool) $params['archived']);
        }
        if (array_key_exists('title', $params) || array_key_exists('notes', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this order.');
            }
            $this->updateContent(
                array_key_exists('title', $params) ? $this->getTitle($params['title']) : $order['title'],
                array_key_exists('notes', $params) ? $this->getNotes($params['notes']) : $order['notes'],
            );
        }
        if (array_key_exists('item_ids', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this order.');
            }
            $this->replaceItems($this->getItemIds($params['item_ids']));
        }
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $order = $this->readOne();
        if ($order['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the author or a team admin can delete this order.');
        }
        $sql = 'DELETE FROM custom_orders WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function updateStatus(string $status): void
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new ImproperActionException('Invalid order status.');
        }
        $sql = 'UPDATE custom_orders SET status = :status WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':status', $status);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateArchived(bool $archived): void
    {
        $sql = 'UPDATE custom_orders SET archived = :archived WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':archived', $archived, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateContent(string $title, ?string $notes): void
    {
        $sql = 'UPDATE custom_orders SET title = :title, notes = :notes WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    // full-replace: whatever set of item ids is passed becomes the order's
    // complete list of linked resources (same idea as the Share modal's
    // canread/canwrite editors -- it shows the current set, Save replaces it)
    private function replaceItems(array $itemIds): void
    {
        $delReq = $this->Db->prepare('DELETE FROM custom_order_items WHERE order_id = :order_id');
        $delReq->bindParam(':order_id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($delReq);

        if (empty($itemIds)) {
            return;
        }
        $insReq = $this->Db->prepare('INSERT INTO custom_order_items (order_id, item_id) VALUES (:order_id, :item_id)');
        foreach ($itemIds as $itemId) {
            $insReq->bindParam(':order_id', $this->id, PDO::PARAM_INT);
            $insReq->bindValue(':item_id', $itemId, PDO::PARAM_INT);
            $this->Db->execute($insReq);
        }
    }

    private function getTitle(mixed $value): string
    {
        $title = Filter::toPureString((string) $value);
        if ($title === '' || mb_strlen($title) > 255) {
            throw new ImproperActionException('A title is required and must be shorter than 255 characters.');
        }
        return $title;
    }

    private function getNotes(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $notes = Filter::toPureString((string) $value);
        if (mb_strlen($notes) > 10000) {
            throw new ImproperActionException('Notes must be shorter than 10000 characters.');
        }
        return $notes;
    }

    /** @return list<int> */
    private function getItemIds(mixed $value): array
    {
        if ($value === null) {
            return array();
        }
        if (!is_array($value)) {
            throw new ImproperActionException('Invalid resource list.');
        }
        $itemIds = array_values(array_unique(array_map(static function (mixed $v): int {
            $itemId = filter_var($v, FILTER_VALIDATE_INT);
            if ($itemId === false) {
                throw new ImproperActionException('Invalid resource.');
            }
            return $itemId;
        }, $value)));
        if (empty($itemIds)) {
            return array();
        }
        $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
        $sql = "SELECT id FROM items WHERE team = ? AND id IN ({$placeholders})";
        $req = $this->Db->prepare($sql);
        $req->execute(array($this->Users->team, ...$itemIds));
        $found = array_map(static fn(array $row): int => (int) $row['id'], $req->fetchAll());
        if (count($found) !== count($itemIds)) {
            throw new ImproperActionException('One or more resources could not be found.');
        }
        return $itemIds;
    }
}
