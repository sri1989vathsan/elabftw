<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use DateTimeImmutable;
use DateTimeZone;
use Elabftw\Enums\Action;
use Elabftw\Enums\Notifications;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Notifications\TodoDeadline;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Elabftw\Traits\SortableTrait;
use Exception;
use Override;
use PDO;

use function _;
use function filter_var;
use function mb_strlen;
use function sprintf;
use function trim;

/**
 * All about the todolist
 */
final class Todolist extends AbstractRest
{
    use SetIdTrait;
    use SortableTrait;

    public function __construct(private int $userid, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/todolist/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $content = $this->getContent($reqBody['content'] ?? '');
        $notes = $this->getNotes($reqBody['notes'] ?? null);
        $deadline = $this->getDeadline($reqBody['deadline'] ?? null);
        $reminderMinutes = $this->getReminderMinutes($reqBody['reminder_minutes'] ?? 60);
        $sql = 'INSERT INTO todolist (body, notes, deadline, reminder_minutes, userid)
            VALUES(:content, :notes, :deadline, :reminder_minutes, :userid)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':content', $content);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':deadline', $deadline, $deadline === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(
            ':reminder_minutes',
            $reminderMinutes,
            $reminderMinutes === null ? PDO::PARAM_NULL : PDO::PARAM_INT,
        );
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);

        $id = $this->Db->lastInsertId();
        $this->setId($id);
        $this->syncDeadlineNotification();
        return $id;
    }

    /**
     * Select all the todoitems for a user
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();
        $completed = $query->getBoolean('completed');
        $completedFilter = $completed ? 'IS NOT NULL' : 'IS NULL';
        $order = $completed ? 'completed_at DESC' : 'ordering ASC, creation_time DESC';
        $completedSince = $completed && $query->has('completed_since')
            ? $this->getDeadline($query->getString('completed_since'))
            : null;
        $completedSinceFilter = $completedSince === null ? '' : ' AND completed_at >= :completed_since';
        $limit = $completed ? ($queryParams->getLimit() ?: 100) : 0;
        $offset = $completed ? max(0, $query->getInt('offset')) : 0;
        $limitSql = $limit > 0 ? sprintf(' LIMIT %d OFFSET %d', $limit, $offset) : '';
        $sql = "SELECT id, body, notes,
                DATE_FORMAT(deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                reminder_minutes,
                DATE_FORMAT(completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                creation_time, ordering, userid
            FROM todolist
            WHERE userid = :userid AND completed_at {$completedFilter}{$completedSinceFilter}
            ORDER BY {$order}{$limitSql}";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        if ($completedSince !== null) {
            $req->bindValue(':completed_since', $completedSince, PDO::PARAM_STR);
        }
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    #[Override]
    public function readOne(): array
    {
        $sql = "SELECT id, body, notes,
                DATE_FORMAT(deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                reminder_minutes,
                DATE_FORMAT(completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                creation_time, ordering, userid
            FROM todolist
            WHERE id = :id AND userid = :userid";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->fetch($req);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        foreach ($params as $key => $value) {
            $this->update($key, $value);
        }
        $this->syncDeadlineNotification();
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->destroyDeadlineNotification();
        $sql = 'DELETE FROM todolist WHERE id = :id AND userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /**
     * Clear all todoitems from the todolist
     */
    public function destroyAll(): bool
    {
        $sql = 'DELETE FROM notifications
            WHERE userid = :userid AND category = :category';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':category', Notifications::TodoDeadline->value, PDO::PARAM_INT);
        $this->Db->execute($req);

        $sql = 'DELETE FROM todolist WHERE userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function update(string $target, mixed $value): bool
    {
        [$column, $content, $type] = match ($target) {
            'content' => array('body', $this->getContent($value), PDO::PARAM_STR),
            'notes' => array('notes', $this->getNotes($value), PDO::PARAM_STR),
            'deadline' => array('deadline', $this->getDeadline($value), PDO::PARAM_STR),
            'reminder_minutes' => array(
                'reminder_minutes',
                $this->getReminderMinutes($value),
                PDO::PARAM_INT,
            ),
            'completed' => array('completed_at', $this->getCompletedAt($value), PDO::PARAM_STR),
            default => throw new ImproperActionException(_('Invalid to-do property.')),
        };
        $sql = sprintf(
            'UPDATE todolist SET %s = :content WHERE id = :id AND userid = :userid',
            $column,
        );
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':content', $content, $content === null ? PDO::PARAM_NULL : $type);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function getContent(mixed $value): string
    {
        $content = Filter::toPureString((string) $value);
        if ($content === '' || mb_strlen($content) > 1000) {
            throw new ImproperActionException(_('A to-do title is required and must be shorter than 1000 characters.'));
        }
        return $content;
    }

    private function getNotes(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $notes = Filter::toPureString((string) $value);
        if (mb_strlen($notes) > 10000) {
            throw new ImproperActionException(_('To-do notes must be shorter than 10000 characters.'));
        }
        return $notes;
    }

    private function getDeadline(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        try {
            return (new DateTimeImmutable((string) $value))
                ->setTimezone(new DateTimeZone('UTC'))
                ->format('Y-m-d H:i:s');
        } catch (Exception) {
            throw new ImproperActionException(_('Invalid to-do deadline.'));
        }
    }

    private function getReminderMinutes(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $minutes = filter_var($value, FILTER_VALIDATE_INT);
        if ($minutes === false || $minutes < 0 || $minutes > 10080) {
            throw new ImproperActionException(_('Reminder time must be between 0 and 10080 minutes.'));
        }
        return $minutes;
    }

    private function getCompletedAt(mixed $value): ?string
    {
        if (!filter_var($value, FILTER_VALIDATE_BOOLEAN)) {
            return null;
        }
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
    }

    private function syncDeadlineNotification(): void
    {
        $task = $this->readOne();
        $this->destroyDeadlineNotification();
        if (!empty($task['completed_at'])
            || empty($task['deadline'])
            || $task['reminder_minutes'] === null
        ) {
            return;
        }
        (new TodoDeadline(
            new Users($this->userid),
            (int) $task['id'],
            $task['body'],
            $task['deadline'],
            (int) $task['reminder_minutes'],
        ))->create();
    }

    private function destroyDeadlineNotification(): void
    {
        if ($this->id === null) {
            return;
        }
        (new TodoDeadline(
            new Users($this->userid),
            $this->id,
            '',
            '1970-01-01 00:00:00',
            0,
        ))->destroy();
    }
}
