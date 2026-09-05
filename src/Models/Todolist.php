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
use function array_column;
use function array_key_exists;
use function array_map;
use function array_unique;
use function array_values;
use function filter_var;
use function in_array;
use function is_array;
use function json_decode;
use function mb_strlen;
use function sprintf;
use function trim;

use const JSON_THROW_ON_ERROR;

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
        $description = $this->getDescription($reqBody['description'] ?? null);
        $deadline = $this->getDeadline($reqBody['deadline'] ?? null);
        $reminderMinutes = $this->getReminderMinutes($reqBody['reminder_minutes'] ?? 60);
        $assigneeUserids = $this->getAssigneeUserids($reqBody['assignee_userids'] ?? $reqBody['assigned_userid'] ?? null);
        $primaryAssignee = $assigneeUserids[0];
        $projectId = $this->getProjectId($reqBody['project_id'] ?? null);
        $priority = $this->getPriority($reqBody['priority'] ?? null);
        // A new task always starts in the team's "To do" column (whichever
        // custom columns exist in between In progress and Done don't apply
        // to brand-new work); moving it elsewhere is a separate patch.
        $sql = "INSERT INTO todolist (body, notes, description, deadline, reminder_minutes, userid, team, assigned_userid, project_id, priority, column_id)
            VALUES(:content, :notes, :description, :deadline, :reminder_minutes, :userid, :team, :assigned_userid, :project_id, :priority,
                (SELECT id FROM todolist_columns WHERE team = :team_col AND kind = 'todo' LIMIT 1))";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':content', $content);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':description', $description, $description === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':deadline', $deadline, $deadline === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(
            ':reminder_minutes',
            $reminderMinutes,
            $reminderMinutes === null ? PDO::PARAM_NULL : PDO::PARAM_INT,
        );
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':team_col', $this->team, PDO::PARAM_INT);
        $req->bindParam(':assigned_userid', $primaryAssignee, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, $projectId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':priority', $priority, $priority === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $this->Db->execute($req);

        $id = (int) $this->Db->lastInsertId();
        $this->setId($id);
        $this->syncAssignees($id, $assigneeUserids);
        $this->syncDeadlineNotification();
        foreach ($assigneeUserids as $assignedUserid) {
            if ($assignedUserid !== $this->userid) {
                $this->notifyAssignee($assignedUserid, $content);
            }
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
        $assignedExists = 'EXISTS (SELECT 1 FROM todolist_task_assignees ta2 WHERE ta2.task_id = t.id AND ta2.userid = %s)';
        $scopeFilter = match ($scope) {
            'team' => '',
            'created' => ' AND t.userid = :requester',
            'all' => ' AND (t.userid = :requester OR ' . sprintf($assignedExists, ':requester2') . ')',
            default => ' AND ' . sprintf($assignedExists, ':requester'),
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
        $sql = "SELECT t.id, t.body, t.notes, t.description,
                DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                t.reminder_minutes,
                DATE_FORMAT(t.completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id, t.in_progress, t.priority, t.column_id,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', au.userid, 'fullname', au.fullname))
                    FROM todolist_task_assignees AS ta
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS au ON au.userid = ta.userid
                    WHERE ta.task_id = t.id
                ), JSON_ARRAY()) AS assignees,
                {$this->entityLinksSubquery()} AS entity_links
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
        if ($scope === 'all') {
            $req->bindParam(':requester2', $this->userid, PDO::PARAM_INT);
        }
        if ($completedSince !== null) {
            $req->bindValue(':completed_since', $completedSince, PDO::PARAM_STR);
        }
        $this->Db->execute($req);

        return array_map(fn(array $row): array => $this->decodeEntityLinks($this->decodeAssignees($row)), $req->fetchAll());
    }

    /**
     * Correlated subquery aggregating a task's linked experiments/templates/
     * resources/resource templates/plain URLs, dropping any entity link
     * whose target was deleted. Shared by readAll() and readOne() -- must be
     * embedded as a string since {t.id} references the outer query's
     * todolist row (a bound parameter can't cross a correlated subquery
     * boundary like this).
     */
    private function entityLinksSubquery(): string
    {
        return "COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('id', link.id, 'entity_type', link.entity_type, 'entity_id', link.entity_id, 'url', link.url, 'title', link.title))
                    FROM (
                        SELECT tel.id, tel.entity_type, tel.entity_id, tel.url,
                            CASE tel.entity_type
                                WHEN 'weblink' THEN tel.label
                                WHEN 'experiments' THEN (SELECT title FROM experiments WHERE id = tel.entity_id)
                                WHEN 'items' THEN (SELECT title FROM items WHERE id = tel.entity_id)
                                WHEN 'experiments_templates' THEN (SELECT title FROM experiments_templates WHERE id = tel.entity_id)
                                WHEN 'items_types' THEN (SELECT title FROM items_types WHERE id = tel.entity_id)
                            END AS title
                        FROM todolist_entity_links AS tel
                        WHERE tel.task_id = t.id
                    ) AS link
                    WHERE link.title IS NOT NULL
                ), JSON_ARRAY())";
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
            WHERE EXISTS (
                    SELECT 1 FROM todolist_task_assignees ta WHERE ta.task_id = todolist.id AND ta.userid = :userid
                )
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
        $sql = "SELECT t.id, t.body, t.notes, t.description,
                DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                t.reminder_minutes,
                DATE_FORMAT(t.completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id, t.in_progress, t.priority, t.column_id,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', au.userid, 'fullname', au.fullname))
                    FROM todolist_task_assignees AS ta
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS au ON au.userid = ta.userid
                    WHERE ta.task_id = t.id
                ), JSON_ARRAY()) AS assignees,
                {$this->entityLinksSubquery()} AS entity_links
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
        return $this->decodeEntityLinks($this->decodeAssignees($task));
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->canWriteOrExplode();
        $previousAssignees = array_map('intval', array_column($this->readOne()['assignees'] ?? array(), 'userid'));
        foreach ($params as $key => $value) {
            if ($key === 'assignee_userids' || $key === 'assigned_userid') {
                continue;
            }
            $this->update($key, $value);
        }
        // Whichever side of the status/column pair was actually touched
        // drives the other, so a task's state stays consistent no matter
        // which UI (this board's columns, or the sidebar's plain checkbox)
        // changed it.
        if (array_key_exists('column_id', $params)) {
            $this->syncStatusFromColumn($this->getColumnId($params['column_id']));
        } elseif (array_key_exists('completed', $params) || array_key_exists('in_progress', $params)) {
            $this->syncColumnFromStatus();
        }
        $newAssignees = null;
        if (array_key_exists('assignee_userids', $params) || array_key_exists('assigned_userid', $params)) {
            $newAssignees = $this->getAssigneeUserids($params['assignee_userids'] ?? $params['assigned_userid']);
            $this->syncAssignees((int) $this->id, $newAssignees);
            $this->updatePrimaryAssignee($newAssignees[0]);
        }
        $this->syncDeadlineNotification();
        $task = $this->readOne();
        if ($newAssignees !== null) {
            foreach ($newAssignees as $assignedUserid) {
                if ($assignedUserid !== $this->userid && !in_array($assignedUserid, $previousAssignees, true)) {
                    $this->notifyAssignee($assignedUserid, $task['body']);
                }
            }
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

        $sql = 'DELETE FROM todolist WHERE team = :team AND id IN (
            SELECT task_id FROM todolist_task_assignees WHERE userid = :userid
        )';
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
        $assigneeIds = array_map('intval', array_column($task['assignees'] ?? array(), 'userid'));
        $isAssignee = in_array($this->userid, $assigneeIds, true);
        if (!$isCreator && !$isAssignee && !$this->requester->isAdmin) {
            throw new IllegalActionException('User tried to modify a task that is not theirs.');
        }
    }

    /**
     * Validate and normalize one or more assignee user ids, restricted to
     * fellow members of the current team. Falls back to self-assignment
     * when nothing is given.
     *
     * @return list<int>
     */
    private function getAssigneeUserids(mixed $value): array
    {
        $raw = is_array($value) ? $value : ($value === null || $value === '' ? array() : array($value));
        $ids = array();
        foreach ($raw as $item) {
            $assignedUserid = filter_var($item, FILTER_VALIDATE_INT);
            if ($assignedUserid === false) {
                throw new ImproperActionException(_('Invalid assignee.'));
            }
            $ids[] = $assignedUserid;
        }
        $ids = array_values(array_unique($ids));
        if (empty($ids)) {
            return array($this->userid);
        }
        foreach ($ids as $assignedUserid) {
            if ($assignedUserid === $this->userid) {
                continue;
            }
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
        return $ids;
    }

    /**
     * Replace the full assignee list for a task with the given user ids
     */
    private function syncAssignees(int $taskId, array $userids): void
    {
        $del = $this->Db->prepare('DELETE FROM todolist_task_assignees WHERE task_id = :task_id');
        $del->bindParam(':task_id', $taskId, PDO::PARAM_INT);
        $this->Db->execute($del);
        foreach ($userids as $userid) {
            $ins = $this->Db->prepare('INSERT INTO todolist_task_assignees(task_id, userid) VALUES(:task_id, :userid)');
            $ins->bindParam(':task_id', $taskId, PDO::PARAM_INT);
            $ins->bindParam(':userid', $userid, PDO::PARAM_INT);
            $this->Db->execute($ins);
        }
    }

    /**
     * Keep the legacy single-assignee column (used for the calendar range
     * query and "clear my tasks") pointed at the first assignee
     */
    private function updatePrimaryAssignee(int $userid): void
    {
        $sql = 'UPDATE todolist SET assigned_userid = :assigned_userid WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':assigned_userid', $userid, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function decodeAssignees(array $row): array
    {
        $row['assignees'] = json_decode((string) $row['assignees'], true, 512, JSON_THROW_ON_ERROR);
        $row['in_progress'] = (bool) $row['in_progress'];
        return $row;
    }

    private function decodeEntityLinks(array $row): array
    {
        $row['entity_links'] = json_decode((string) $row['entity_links'], true, 512, JSON_THROW_ON_ERROR);
        return $row;
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

    private function getPriority(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!in_array($value, array('low', 'medium', 'high'), true)) {
            throw new ImproperActionException(_('Invalid priority.'));
        }
        return $value;
    }

    private function getColumnId(mixed $value): int
    {
        $columnId = filter_var($value, FILTER_VALIDATE_INT);
        if ($columnId === false) {
            throw new ImproperActionException(_('Invalid column.'));
        }
        $sql = 'SELECT COUNT(*) AS count FROM todolist_columns WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $columnId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException(_('Column not found in this team.'));
        }
        return $columnId;
    }

    /**
     * The column's kind (fixed for the three built-ins) determines what the
     * legacy completed_at/in_progress fields should be, so the sidebar
     * widget, calendar and notifications (which only know about those two
     * fields) keep behaving correctly regardless of how many custom columns
     * exist in between.
     */
    private function syncStatusFromColumn(int $columnId): void
    {
        $sql = 'SELECT kind FROM todolist_columns WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $columnId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $kind = $this->Db->fetch($req)['kind'] ?? 'custom';

        $sql = 'UPDATE todolist SET completed_at = :completed_at, in_progress = :in_progress WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':completed_at', $kind === 'done' ? $this->getCompletedAt(true) : null, $kind === 'done' ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $req->bindValue(':in_progress', (int) ($kind === 'in_progress'), PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    /**
     * The reverse sync: something patched the legacy completed_at/in_progress
     * fields directly (e.g. the sidebar widget's own complete checkbox, which
     * has no concept of columns) -- move the task into the matching built-in
     * column so the project management board doesn't show it stuck wherever
     * it happened to be.
     */
    private function syncColumnFromStatus(): void
    {
        $task = $this->readOne();
        $kind = !empty($task['completed_at']) ? 'done' : ($task['in_progress'] ? 'in_progress' : 'todo');
        $sql = 'UPDATE todolist AS t
            INNER JOIN todolist_columns AS c ON c.team = t.team AND c.kind = :kind
            SET t.column_id = c.id
            WHERE t.id = :id AND t.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':kind', $kind);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
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
            'project_id' => array('project_id', $this->getProjectId($value), PDO::PARAM_INT),
            'description' => array('description', $this->getDescription($value), PDO::PARAM_STR),
            'in_progress' => array('in_progress', (int) (bool) $value, PDO::PARAM_INT),
            'priority' => array('priority', $this->getPriority($value), PDO::PARAM_STR),
            'column_id' => array('column_id', $this->getColumnId($value), PDO::PARAM_INT),
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
        // Filter::body() (not toPureString()) so the rich text editor's
        // headings/lists/bold/etc. survive -- toPureString() strips all HTML.
        $notes = Filter::body((string) $value);
        if (mb_strlen($notes) > 10000) {
            throw new ImproperActionException(_('To-do notes must be shorter than 10000 characters.'));
        }
        return $notes;
    }

    private function getDescription(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $description = Filter::body((string) $value);
        if (mb_strlen($description) > 10000) {
            throw new ImproperActionException(_('To-do description must be shorter than 10000 characters.'));
        }
        return $description;
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
        foreach ($this->getAssigneeIdsForNotification($task) as $assignedUserid) {
            (new TodoDeadline(
                new Users($assignedUserid, $this->team),
                (int) $task['id'],
                $task['body'],
                $task['deadline'],
                (int) $task['reminder_minutes'],
            ))->create();
        }
    }

    private function destroyDeadlineNotification(): void
    {
        if ($this->id === null) {
            return;
        }
        $task = $this->readOne();
        foreach ($this->getAssigneeIdsForNotification($task) as $assignedUserid) {
            (new TodoDeadline(
                new Users($assignedUserid, $this->team),
                $this->id,
                '',
                '1970-01-01 00:00:00',
                0,
            ))->destroy();
        }
    }

    /** @return list<int> */
    private function getAssigneeIdsForNotification(array $task): array
    {
        $ids = array_map('intval', array_column($task['assignees'] ?? array(), 'userid'));
        if (empty($ids)) {
            $ids = array((int) ($task['assigned_userid'] ?? $this->userid));
        }
        return $ids;
    }
}
