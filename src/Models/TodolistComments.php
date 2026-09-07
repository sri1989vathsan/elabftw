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
use Elabftw\Models\Notifications\MentionedInTask;
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
 * Comments on an assignable to-do task. Anyone who can see the task (its
 * creator, its assignee, or a team admin) can comment; only the comment's
 * author or a team admin can delete it.
 */
final class TodolistComments extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private Todolist $Task, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/todolist/%d/comments/', $this->Task->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT comment.id, comment.body,
                DATE_FORMAT(comment.created_at, \'%Y-%m-%dT%H:%i:%s\') AS created_at,
                comment.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_todolist_comments AS comment
            INNER JOIN todolist AS task ON task.id = comment.task_id AND task.team = :team
            LEFT JOIN users AS author ON author.userid = comment.userid
            WHERE comment.task_id = :task_id
            ORDER BY comment.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
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
        $sql = 'INSERT INTO custom_todolist_comments (task_id, userid, body)
            SELECT task.id, :userid, :body
            FROM todolist AS task
            WHERE task.id = :task_id AND task.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
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
        $task = $this->Task->readOne();
        foreach (array_map('intval', $userids) as $userid) {
            if ($userid === $this->Users->userid || !$this->isTeamMember($userid)) {
                continue;
            }
            (new MentionedInTask(
                new Users($userid, $this->Users->team),
                $this->Users,
                (int) $this->Task->id,
                (string) $task['body'],
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
        $sql = 'DELETE FROM custom_todolist_comments WHERE id = :id AND task_id = :task_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);

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
