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
use Elabftw\Models\Notifications\MentionedInOrder;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_map;
use function is_array;
use function mb_strlen;
use function sprintf;

/**
 * Comments on an order, so people can discuss it (quotes, alternatives,
 * delivery status) the same way feedback board items work.
 */
final class OrderComments extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private Orders $Order, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/orders/%d/comments/', $this->Order->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT comment.id, comment.body, comment.created_at, comment.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_order_comments AS comment
            INNER JOIN custom_orders AS o ON o.id = comment.order_id AND o.team = :team
            LEFT JOIN users AS author ON author.userid = comment.userid
            WHERE comment.order_id = :order_id
            ORDER BY comment.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$comment) {
            $comment['id'] = (int) $comment['id'];
            $comment['userid'] = (int) $comment['userid'];
        }

        return $result;
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $comment) {
            if ($comment['id'] === $this->id) {
                return $comment;
            }
        }
        throw new ResourceNotFoundException();
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $body = $this->getBody($reqBody['body'] ?? '');
        $sql = 'INSERT INTO custom_order_comments (order_id, userid, body)
            SELECT o.id, :userid, :body
            FROM custom_orders AS o
            WHERE o.id = :order_id AND o.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':body', $body);
        $this->Db->execute($req);
        if ($req->rowCount() === 0) {
            throw new ResourceNotFoundException();
        }
        $commentId = (int) $this->Db->lastInsertId();
        $this->notifyMentioned(is_array($reqBody['mentioned_userids'] ?? null) ? $reqBody['mentioned_userids'] : array());

        return $commentId;
    }

    private function notifyMentioned(array $userids): void
    {
        if (empty($userids)) {
            return;
        }
        $order = $this->Order->readOne();
        foreach (array_map('intval', $userids) as $userid) {
            if ($userid === $this->Users->userid || !$this->isTeamMember($userid)) {
                continue;
            }
            (new MentionedInOrder(
                new Users($userid, $this->Users->team),
                $this->Users,
                (int) $this->Order->id,
                (string) $order['title'],
            ))->create();
        }
    }

    private function isTeamMember(int $userid): bool
    {
        $sql = 'SELECT 1 FROM users2teams WHERE userid = :userid AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $userid, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetch() !== false;
    }

    #[Override]
    public function destroy(): bool
    {
        $comment = $this->readOne();
        if ($comment['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the author or a team admin can delete this comment.');
        }
        $sql = 'DELETE FROM custom_order_comments WHERE id = :id AND order_id = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function getBody(mixed $value): string
    {
        $body = Filter::toPureString((string) $value);
        if ($body === '' || mb_strlen($body) > 5000) {
            throw new ImproperActionException('A comment is required and must be shorter than 5000 characters.');
        }
        return $body;
    }
}
