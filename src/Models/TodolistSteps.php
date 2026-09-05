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

/**
 * A simple ordered, checkable list of steps on an assignable to-do task --
 * lighter than the full experiment Steps feature (no deadlines/reminders),
 * just a sequence of "did this happen yet" line items.
 */
final class TodolistSteps extends AbstractRest
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
        return sprintf('api/v2/todolist/%d/steps/', $this->Task->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT step.id, step.body, step.ordering, step.finished
            FROM custom_todolist_steps AS step
            INNER JOIN todolist AS task ON task.id = step.task_id AND task.team = :team
            WHERE step.task_id = :task_id
            ORDER BY step.ordering ASC, step.id ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$step) {
            $step['id'] = (int) $step['id'];
            $step['ordering'] = (int) $step['ordering'];
            $step['finished'] = (bool) $step['finished'];
        }

        return $result;
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $step) {
            if ($step['id'] === $this->id) {
                return $step;
            }
        }
        throw new ResourceNotFoundException();
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $body = $this->getBody($reqBody['body'] ?? '');
        $sql = 'INSERT INTO custom_todolist_steps (task_id, body, ordering)
            SELECT task.id, :body, COALESCE((
                SELECT MAX(ordering) + 1 FROM custom_todolist_steps WHERE task_id = task.id
            ), 0)
            FROM todolist AS task
            WHERE task.id = :task_id AND task.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':body', $body);
        $this->Db->execute($req);
        if ($req->rowCount() === 0) {
            throw new ResourceNotFoundException();
        }

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        if ($action !== Action::Update) {
            throw new ImproperActionException('Invalid action for a step.');
        }
        $sets = array();
        $sql = 'UPDATE custom_todolist_steps AS step
            INNER JOIN todolist AS task ON task.id = step.task_id AND task.team = :team';
        $bind = array(':team' => array($this->Users->team, PDO::PARAM_INT), ':id' => array($this->id, PDO::PARAM_INT));
        if (isset($params['finished'])) {
            $sets[] = 'step.finished = :finished';
            $bind[':finished'] = array((int) (bool) $params['finished'], PDO::PARAM_INT);
        }
        if (isset($params['body'])) {
            $sets[] = 'step.body = :body';
            $bind[':body'] = array($this->getBody($params['body']), PDO::PARAM_STR);
        }
        if (isset($params['ordering'])) {
            $sets[] = 'step.ordering = :ordering';
            $bind[':ordering'] = array((int) $params['ordering'], PDO::PARAM_INT);
        }
        if ($sets === array()) {
            return $this->readOne();
        }
        $sql .= ' SET ' . implode(', ', $sets) . ' WHERE step.id = :id';
        $req = $this->Db->prepare($sql);
        foreach ($bind as $param => $valueAndType) {
            $req->bindValue($param, $valueAndType[0], $valueAndType[1]);
        }
        $this->Db->execute($req);

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE step FROM custom_todolist_steps AS step
            INNER JOIN todolist AS task ON task.id = step.task_id AND task.team = :team
            WHERE step.id = :id AND step.task_id = :task_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function getBody(mixed $value): string
    {
        $body = Filter::toPureString((string) $value);
        if ($body === '' || mb_strlen($body) > 500) {
            throw new ImproperActionException('A step is required and must be shorter than 500 characters.');
        }
        return $body;
    }
}
