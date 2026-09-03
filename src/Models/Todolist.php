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
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Notifications\TaskAssigned;
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
 * All about the todolist, including tasks assigned to teammates (project management)
 */
final class Todolist extends AbstractRest
{
    use SetIdTrait;
    use SortableTrait;

    private int $userid;

    private int $team;

    public function __construct(private Users $requester, ?int $id = null)
    {
        parent::__construct();
        $this->userid = (int) $this->requester->userData['userid'];
        $this->team = (int) $this->requester->userData['team'];
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
        $assignedUserid = $this->getAssignedUserid($reqBody['assigned_userid'] ?? null);
        $projectId = $this->getProjectId($reqBody['project_id'] ?? null);
        $sql = 'INSERT INTO todolist (body, notes, deadline, reminder_minutes, userid, team, assigned_userid, project_id)
            VALUES(:content, :notes, :deadline, :reminder_minutes, :userid, :team, :assigned_userid, :project_id)';
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
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':assigned_userid', $assignedUserid, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, $projectId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $this->Db->execute($req);

        $id = $this->Db->lastInsertId();
        $this->setId($id);
        $this->syncDeadlineNotification();
        if ($assignedUserid !== $this->userid) {
            $this->notifyAssignee($assignedUserid, $content);
        }
        return $id;
    }

    /**
     * Select to-do items: by default the ones assigned to the requester, or
     * ?scope=team for the whole team's board, or ?scope=created for tasks
     * the requester handed off to someone else.
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();
        if ($query->getBoolean('calendar')) {
            return $this->readCalendarRange($queryParams);
        }
        $scope = $query->getString('scope') ?: 'assigned';
        $scopeFilter = match ($scope) {
            'team' => '',
            'created' => ' AND userid = :requester',
            default => ' AND assigned_userid = :requester',
        };
        $completed = $query->getBoolean('completed');
        $completedFilter = $completed ? 'IS NOT NULL' : 'IS NULL';
        $order = $completed ? 'completed_at DESC' : 'ordering ASC, creation_time DESC';
        $completedSince = $completed && $query->has('completed_since')
            ? $this->getDeadline($query->getString('completed_since'))
            : null;
        $completedSinceFilter = $completedSince === null ? '' : ' AND completed_at >= :completed_since';
        // Keep sidebar payloads bounded for long-lived accounts. Clients can
        // request subsequent pages with offset.
        $limit = $queryParams->getLimit() ?: 100;
        $offset = max(0, $query->getInt('offset'));
        $limitSql = $limit > 0 ? sprintf(' LIMIT %d OFFSET %d', $limit, $offset) : '';
        $sql = "SELECT t.id, t.body, t.notes,
                DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                t.reminder_minutes,
                DATE_FORMAT(t.completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name
            FROM todolist AS t
            LEFT JOIN users AS creator ON creator.userid = t.userid
            LEFT JOIN users AS assignee ON assignee.userid = t.assigned_userid
            LEFT JOIN todolist_projects AS project ON project.id = t.project_id
            WHERE t.team = :team AND t.completed_at {$completedFilter}{$completedSinceFilter}{$scopeFilter}
            ORDER BY {$order}{$limitSql}";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        if ($scope !== 'team') {
            $req->bindParam(':requester', $this->userid, PDO::PARAM_INT);
        }
        if ($completedSince !== null) {
            $req->bindValue(':completed_since', $completedSince, PDO::PARAM_STR);
        }
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    /**
     * Return scheduled tasks, including completed ones, for a bounded calendar range.
     */
    private function readCalendarRange(QueryParamsInterface $queryParams): array
    {
        $query = $queryParams->getQuery();
        if (!$query->has('deadline_from') || !$query->has('deadline_to')) {
            throw new ImproperActionException(_('Calendar task queries require a start and end date.'));
        }
        $deadlineFrom = $this->getDeadline($query->getString('deadline_from'));
        $deadlineTo = $this->getDeadline($query->getString('deadline_to'));
        if ($deadlineFrom === null || $deadlineTo === null || $deadlineFrom >= $deadlineTo) {
            throw new ImproperActionException(_('Invalid calendar task date range.'));
        }
        $sql = "SELECT id, body, notes,
                DATE_FORMAT(deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                reminder_minutes,
                DATE_FORMAT(completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                creation_time, ordering, userid, team, assigned_userid
            FROM todolist
            WHERE assigned_userid = :userid
                AND deadline >= :deadline_from
                AND deadline < :deadline_to
            ORDER BY deadline ASC, id ASC";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':deadline_from', $deadlineFrom, PDO::PARAM_STR);
        $req->bindValue(':deadline_to', $deadlineTo, PDO::PARAM_STR);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    public function readOne(): array
    {
        $sql = "SELECT t.id, t.body, t.notes,
                DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                t.reminder_minutes,
                DATE_FORMAT(t.completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name
            FROM todolist AS t
            LEFT JOIN users AS creator ON creator.userid = t.userid
            LEFT JOIN users AS assignee ON assignee.userid = t.assigned_userid
            LEFT JOIN todolist_projects AS project ON project.id = t.project_id
            WHERE t.id = :id AND t.team = :team";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        $task = $this->Db->fetch($req);
        if ($task === false) {
            return array();
        }
        return $task;
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->canWriteOrExplode();
        $previousAssignee = (int) ($this->readOne()['assigned_userid'] ?? $this->userid);
        foreach ($params as $key => $value) {
            $this->update($key, $value);
        }
        $this->syncDeadlineNotification();
        $task = $this->readOne();
        $newAssignee = (int) ($task['assigned_userid'] ?? $this->userid);
        if (array_key_exists('assigned_userid', $params) && $newAssignee !== $previousAssignee && $newAssignee !== $this->userid) {
            $this->notifyAssignee($newAssignee, $task['body']);
        }
        return $task;
    }

    #[Override]
    public function destroy(): bool
    {
        $this->canWriteOrExplode();
        $this->destroyDeadlineNotification();
        $sql = 'DELETE FROM todolist WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /**
     * Clear all todoitems assigned to the requester
     */
    public function destroyAll(): bool
    {
        $sql = 'DELETE FROM notifications
            WHERE userid = :userid AND category = :category';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':category', Notifications::TodoDeadline->value, PDO::PARAM_INT);
        $this->Db->execute($req);

        $sql = 'DELETE FROM todolist WHERE assigned_userid = :userid AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /**
     * A task can be managed by whoever created it, whoever it's assigned to, or a team admin
     */
    private function canWriteOrExplode(): void
    {
        $task = $this->readOne();
        if (empty($task)) {
            throw new IllegalActionException('Task not found in this team.');
        }
        $isCreator = (int) $task['userid'] === $this->userid;
        $isAssignee = (int) ($task['assigned_userid'] ?? 0) === $this->userid;
        if (!$isCreator && !$isAssignee && !$this->requester->isAdmin) {
            throw new IllegalActionException('User tried to modify a task that is not theirs.');
        }
    }

    private function getAssignedUserid(mixed $value): int
    {
        if ($value === null || $value === '') {
            return $this->userid;
        }
        $assignedUserid = filter_var($value, FILTER_VALIDATE_INT);
        if ($assignedUserid === false) {
            throw new ImproperActionException(_('Invalid assignee.'));
        }
        if ($assignedUserid !== $this->userid) {
            // only allow assigning to a fellow member of the current team
            $sql = 'SELECT COUNT(*) AS count FROM users2teams WHERE users_id = :userid AND teams_id = :team';
            $req = $this->Db->prepare($sql);
            $req->bindParam(':userid', $assignedUserid, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
            if ((int) $this->Db->fetch($req)['count'] === 0) {
                throw new ImproperActionException(_('You can only assign tasks to a member of your team.'));
            }
        }
        return $assignedUserid;
    }

    private function getProjectId(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $projectId = filter_var($value, FILTER_VALIDATE_INT);
        if ($projectId === false) {
            throw new ImproperActionException(_('Invalid project.'));
        }
        $sql = 'SELECT COUNT(*) AS count FROM todolist_projects WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $projectId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException(_('Project not found in this team.'));
        }
        return $projectId;
    }

    private function notifyAssignee(int $assignedUserid, string $title): void
    {
        (new TaskAssigned(
            new Users($assignedUserid, $this->team),
            $this->requester,
            (int) $this->id,
            $title,
        ))->create();
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
            'assigned_userid' => array('assigned_userid', $this->getAssignedUserid($value), PDO::PARAM_INT),
            'project_id' => array('project_id', $this->getProjectId($value), PDO::PARAM_INT),
            default => throw new ImproperActionException(_('Invalid to-do property.')),
        };
        $sql = sprintf(
            'UPDATE todolist SET %s = :content WHERE id = :id AND team = :team',
            $column,
        );
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':content', $content, $content === null ? PDO::PARAM_NULL : $type);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

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
            new Users((int) ($task['assigned_userid'] ?? $this->userid), $this->team),
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
        $task = $this->readOne();
        $assignedUserid = (int) ($task['assigned_userid'] ?? $this->userid);
        (new TodoDeadline(
            new Users($assignedUserid, $this->team),
            $this->id,
            '',
            '1970-01-01 00:00:00',
            0,
        ))->destroy();
    }
}
