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

use function array_key_exists;
use function in_array;
use function mb_strlen;
use function trim;

/**
 * A team-scoped "please order this" board, replacing an external Trello
 * board. Unlike the native procurement_requests table, an order does not
 * require an existing procurable resource -- item_id is optional, and can
 * point at any Resources database item, not only ones marked procurable.
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
        $itemId = $this->getItemId($reqBody['item_id'] ?? null);
        $sql = 'INSERT INTO custom_orders (team, userid, title, notes, item_id)
            VALUES (:team, :userid, :title, :notes, :item_id)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':item_id', $itemId, $itemId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT o.id, o.title, o.notes, o.status, o.archived, o.created_at, o.userid, o.item_id,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname,
                item.title AS item_title,
                COALESCE((
                    SELECT GROUP_CONCAT(comment.body SEPARATOR " ")
                    FROM custom_order_comments AS comment
                    WHERE comment.order_id = o.id
                ), "") AS comments_text,
                COALESCE((
                    SELECT GROUP_CONCAT(upload.real_name SEPARATOR " ")
                    FROM custom_order_uploads AS upload
                    WHERE upload.order_id = o.id
                ), "") AS attachments_text
            FROM custom_orders AS o
            LEFT JOIN users AS author ON author.userid = o.userid
            LEFT JOIN items AS item ON item.id = o.item_id
            WHERE o.team = :team
            ORDER BY o.created_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$order) {
            $order['id'] = (int) $order['id'];
            $order['userid'] = (int) $order['userid'];
            $order['item_id'] = $order['item_id'] !== null ? (int) $order['item_id'] : null;
            $order['archived'] = (bool) $order['archived'];
        }

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
        if (array_key_exists('title', $params) || array_key_exists('notes', $params) || array_key_exists('item_id', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this order.');
            }
            $this->updateContent(
                array_key_exists('title', $params) ? $this->getTitle($params['title']) : $order['title'],
                array_key_exists('notes', $params) ? $this->getNotes($params['notes']) : $order['notes'],
                array_key_exists('item_id', $params) ? $this->getItemId($params['item_id']) : $order['item_id'],
            );
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

    private function updateContent(string $title, ?string $notes, ?int $itemId): void
    {
        $sql = 'UPDATE custom_orders SET title = :title, notes = :notes, item_id = :item_id WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':item_id', $itemId, $itemId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
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

    private function getItemId(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $itemId = filter_var($value, FILTER_VALIDATE_INT);
        if ($itemId === false) {
            throw new ImproperActionException('Invalid resource.');
        }
        $sql = 'SELECT id FROM items WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $itemId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ($req->fetch() === false) {
            throw new ImproperActionException('Resource not found.');
        }
        return $itemId;
    }
}
