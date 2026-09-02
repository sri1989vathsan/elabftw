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

use function in_array;
use function mb_strlen;
use function trim;

/**
 * A team-scoped bug/feature request board. Any team member can add an item
 * and any team member can upvote one, so the team can see what matters most
 * to people without an admin having to curate the list first.
 */
final class Feedback extends AbstractRest
{
    use SetIdTrait;

    private const array TYPES = array('bug', 'feature');

    private const array STATUSES = array('open', 'planned', 'done', 'declined');

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/feedback/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $type = in_array($reqBody['type'] ?? null, self::TYPES, true) ? $reqBody['type'] : 'feature';
        $title = $this->getTitle($reqBody['title'] ?? '');
        $body = $this->getBody($reqBody['body'] ?? null);
        $sql = 'INSERT INTO custom_feedback_items (team, userid, type, title, body)
            VALUES (:team, :userid, :type, :title, :body)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':type', $type);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $this->Db->execute($req);
        $id = (int) $this->Db->lastInsertId();
        $this->setId($id);
        // the person posting an item automatically upvotes their own idea
        $this->setVote(true);

        return $id;
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT item.id, item.type, item.title, item.body, item.status, item.created_at,
                item.userid, CONCAT(author.firstname, " ", author.lastname) AS author_fullname,
                COALESCE(votes.vote_count, 0) AS vote_count,
                (my_vote.userid IS NOT NULL) AS has_voted
            FROM custom_feedback_items AS item
            LEFT JOIN users AS author ON author.userid = item.userid
            LEFT JOIN (
                SELECT item_id, COUNT(*) AS vote_count FROM custom_feedback_votes GROUP BY item_id
            ) AS votes ON votes.item_id = item.id
            LEFT JOIN custom_feedback_votes AS my_vote
                ON my_vote.item_id = item.id AND my_vote.userid = :userid
            WHERE item.team = :team
            ORDER BY vote_count DESC, item.created_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$item) {
            $item['id'] = (int) $item['id'];
            $item['userid'] = (int) $item['userid'];
            $item['vote_count'] = (int) $item['vote_count'];
            $item['has_voted'] = (bool) $item['has_voted'];
        }

        return $result;
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $item) {
            if ($item['id'] === $this->id) {
                return $item;
            }
        }
        throw new ResourceNotFoundException();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $item = $this->readOne();
        if ($action === Action::ToggleVote) {
            $this->setVote(!$item['has_voted']);
            return $this->readOne();
        }
        if ($action !== Action::Update) {
            throw new ImproperActionException('Invalid action parameter.');
        }
        $isOwner = $item['userid'] === $this->Users->userid;
        if (array_key_exists('status', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can change the status of this item.');
            }
            $this->updateStatus((string) $params['status']);
        }
        if (array_key_exists('title', $params) || array_key_exists('body', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this item.');
            }
            $this->updateContent(
                array_key_exists('title', $params) ? $this->getTitle($params['title']) : $item['title'],
                array_key_exists('body', $params) ? $this->getBody($params['body']) : $item['body'],
            );
        }
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $item = $this->readOne();
        if ($item['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the author or a team admin can delete this item.');
        }
        $sql = 'DELETE FROM custom_feedback_items WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function setVote(bool $wantsVote): void
    {
        if ($wantsVote) {
            $sql = 'INSERT IGNORE INTO custom_feedback_votes (item_id, userid) VALUES (:item_id, :userid)';
        } else {
            $sql = 'DELETE FROM custom_feedback_votes WHERE item_id = :item_id AND userid = :userid';
        }
        $req = $this->Db->prepare($sql);
        $req->bindParam(':item_id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateStatus(string $status): void
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new ImproperActionException('Invalid feedback status.');
        }
        $sql = 'UPDATE custom_feedback_items SET status = :status WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':status', $status);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateContent(string $title, ?string $body): void
    {
        $sql = 'UPDATE custom_feedback_items SET title = :title, body = :body WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
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

    private function getBody(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $body = Filter::toPureString((string) $value);
        if (mb_strlen($body) > 10000) {
            throw new ImproperActionException('Description must be shorter than 10000 characters.');
        }
        return $body;
    }
}
