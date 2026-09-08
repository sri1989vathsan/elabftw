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

use function mb_strlen;
use function sprintf;
use function trim;

/**
 * Comments on a feedback board item. Anyone on the team can comment, same
 * as anyone can post an item or vote; only the comment's author or a team
 * admin can delete it.
 */
final class FeedbackComments extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private Feedback $Item, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/feedback/%d/comments/', $this->Item->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT comment.id, comment.body, comment.created_at, comment.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_feedback_comments AS comment
            INNER JOIN custom_feedback_items AS item ON item.id = comment.item_id AND item.team = :team
            LEFT JOIN users AS author ON author.userid = comment.userid
            WHERE comment.item_id = :item_id
            ORDER BY comment.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':item_id', $this->Item->id, PDO::PARAM_INT);
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
        $sql = 'INSERT INTO custom_feedback_comments (item_id, userid, body)
            SELECT item.id, :userid, :body
            FROM custom_feedback_items AS item
            WHERE item.id = :item_id AND item.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':item_id', $this->Item->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':body', $body);
        $this->Db->execute($req);
        if ($req->rowCount() === 0) {
            throw new ResourceNotFoundException();
        }

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function destroy(): bool
    {
        $comment = $this->readOne();
        if ($comment['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the author or a team admin can delete this comment.');
        }
        $sql = 'DELETE FROM custom_feedback_comments WHERE id = :id AND item_id = :item_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':item_id', $this->Item->id, PDO::PARAM_INT);

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
