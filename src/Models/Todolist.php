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
        // Each project can have its own private copy of the columns (see
        // TodolistColumns::ensureProjectColumns()), so an explicit column_id
        // from the request (the board's own "+" button) isn't trusted as
        // literally correct on its own -- it might belong to whatever
        // column set the client happened to have loaded (e.g. the All tab's
        // team-wide default) rather than the target project's own copy.
        // Resolve to the equivalent column, by kind, within the actual
        // target project (falling back to "todo" for a brand-new task with
        // no column_id given at all); moving it to a different kind of
        // column afterwards is a separate patch.
        $explicitColumnId = array_key_exists('column_id', $reqBody) && $reqBody['column_id'] !== null
            ? $this->getColumnId($reqBody['column_id'])
            : null;
        $columnKind = $explicitColumnId !== null
            ? ($this->getColumnKind($explicitColumnId) ?? 'todo')
            : 'todo';
        $columnId = $this->resolveColumnIdForKind($columnKind, $projectId) ?? $explicitColumnId;
        $sql = 'INSERT INTO todolist (body, notes, description, deadline, reminder_minutes, userid, team, assigned_userid, project_id, priority, column_id)
            VALUES(:content, :notes, :description, :deadline, :reminder_minutes, :userid, :team, :assigned_userid, :project_id, :priority, :column_id)';
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
        $req->bindParam(':assigned_userid', $primaryAssignee, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, $projectId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':column_id', $columnId, $columnId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
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
        // "All" within a project (as opposed to one specific subproject)
        // rolls its subprojects' tasks in too -- a subproject's tasks would
        // otherwise vanish from the project's own combined view, visible
        // only under their own separate tab
        $includeSubprojects = $query->getBoolean('include_subprojects');
        if ($query->getBoolean('counts')) {
            $projectId = $this->getProjectId($query->getInt('project_id') ?: null);
            $unfiled = $query->getBoolean('unfiled');
            return array($this->readCounts($scope, $scopeFilter, $projectId, $unfiled, $includeSubprojects));
        }
        $completed = $query->getBoolean('completed');
        $completedFilter = $completed ? 'IS NOT NULL' : 'IS NULL';
        $order = $completed ? 'pinned DESC, completed_at DESC' : 'pinned DESC, ordering ASC, creation_time DESC';
        $completedSince = $completed && $query->has('completed_since')
            ? $this->getDeadline($query->getString('completed_since'))
            : null;
        $completedSinceFilter = $completedSince === null ? '' : ' AND completed_at >= :completed_since';

        // Board-side filters (project/unfiled, priority, search) narrow the
        // list itself server-side, same as scope/completed above -- the
        // client used to fetch everything team-wide and filter these three
        // in memory, which doesn't scale once a team has more tasks than a
        // single page. Counts (readCounts()) deliberately stay untouched by
        // these -- see its own docblock -- keeping that aggregate a cheap,
        // separate concern from whatever page of the list is loaded.
        $projectId = $this->getProjectId($query->getInt('project_id') ?: null);
        $unfiled = $query->getBoolean('unfiled');
        $projectFilter = '';
        if ($projectId !== null && $includeSubprojects) {
            $projectFilter = ' AND (t.project_id = :filter_project_id OR t.project_id IN (SELECT id FROM todolist_projects WHERE parent_id = :filter_project_id_subprojects))';
        } elseif ($projectId !== null) {
            $projectFilter = ' AND t.project_id = :filter_project_id';
        } elseif ($unfiled) {
            $projectFilter = ' AND t.project_id IS NULL';
        }

        $priority = $query->getString('priority');
        $priorityFilter = '';
        if (in_array($priority, array('low', 'medium', 'high'), true)) {
            $priorityFilter = ' AND t.priority = :priority';
        }

        // each condition gets its own placeholder name bound to the same
        // $like value (rather than reusing one :search placeholder several
        // times), matching Orders::readAll()'s own search -- established
        // here as the safe convention regardless of PDO's prepare mode
        $search = trim($query->getString('search'));
        $searchFilter = '';
        $searchBind = array();
        if ($search !== '') {
            $like = '%' . $search . '%';
            $searchConditions = array(
                't.body LIKE :search_body',
                't.notes LIKE :search_notes',
                't.description LIKE :search_description',
                't.priority LIKE :search_priority',
                'project.name LIKE :search_project',
                'CONCAT(creator.firstname, " ", creator.lastname) LIKE :search_creator',
                'CONCAT(assignee.firstname, " ", assignee.lastname) LIKE :search_assignee',
                // the multi-assignee list (todolist_task_assignees), distinct
                // from the single legacy assigned_userid joined above as "assignee"
                'EXISTS (SELECT 1 FROM todolist_task_assignees AS s_ta
                    INNER JOIN users AS s_au ON s_au.userid = s_ta.userid
                    WHERE s_ta.task_id = t.id AND CONCAT(s_au.firstname, " ", s_au.lastname) LIKE :search_multi_assignee)',
                // linked experiments/resources/templates/weblinks -- mirrors
                // entityLinksSubquery()'s own per-entity-type title lookup
                'EXISTS (SELECT 1 FROM todolist_entity_links AS s_tel
                    WHERE s_tel.task_id = t.id AND (
                        s_tel.label LIKE :search_link_label
                        OR (s_tel.entity_type = "experiments" AND EXISTS (SELECT 1 FROM experiments WHERE id = s_tel.entity_id AND title LIKE :search_link_experiments))
                        OR (s_tel.entity_type = "items" AND EXISTS (SELECT 1 FROM items WHERE id = s_tel.entity_id AND title LIKE :search_link_items))
                        OR (s_tel.entity_type = "experiments_templates" AND EXISTS (SELECT 1 FROM experiments_templates WHERE id = s_tel.entity_id AND title LIKE :search_link_exp_templates))
                        OR (s_tel.entity_type = "items_types" AND EXISTS (SELECT 1 FROM items_types WHERE id = s_tel.entity_id AND title LIKE :search_link_item_types))
                    ))',
            );
            $searchFilter = ' AND (' . implode(' OR ', $searchConditions) . ')';
            foreach (array(
                'search_body', 'search_notes', 'search_description', 'search_priority',
                'search_project', 'search_creator', 'search_assignee', 'search_multi_assignee',
                'search_link_label', 'search_link_experiments', 'search_link_items',
                'search_link_exp_templates', 'search_link_item_types',
            ) as $name) {
                $searchBind[$name] = $like;
            }
        }

        // Keep sidebar payloads bounded for long-lived accounts. Clients can
        // request subsequent pages with offset.
        $limit = $queryParams->getLimit() ?: 100;
        $offset = max(0, $query->getInt('offset'));
        $limitSql = $limit > 0 ? sprintf(' LIMIT %d OFFSET %d', $limit, $offset) : '';
        $sql = "SELECT t.id, t.body, t.notes, t.description,
                DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i:%sZ') AS deadline,
                t.reminder_minutes,
                DATE_FORMAT(t.completed_at, '%Y-%m-%dT%H:%i:%sZ') AS completed_at,
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id, t.in_progress, t.priority, t.column_id, t.pinned,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name,
                parent_project.name AS project_parent_name,
                col.kind AS column_kind,
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
            LEFT JOIN todolist_projects AS parent_project ON parent_project.id = project.parent_id
            LEFT JOIN todolist_columns AS col ON col.id = t.column_id
            WHERE t.team = :team AND t.completed_at {$completedFilter}{$completedSinceFilter}{$scopeFilter}{$projectFilter}{$priorityFilter}{$searchFilter}
                -- archiving a project takes its tasks off the active board
                -- entirely (All, search, counts) -- readOne() deliberately
                -- doesn't apply this, so a direct link to one of them (e.g.
                -- from an existing notification) still opens
                AND (t.project_id IS NULL OR project.archived = 0)
                AND (
                    t.project_id IS NULL
                    OR project.userid = :requester3
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = t.project_id AND pm.userid = :requester4)
                    OR (project.parent_id IS NOT NULL AND (
                        EXISTS (SELECT 1 FROM todolist_projects AS pp WHERE pp.id = project.parent_id AND pp.userid = :requester5)
                        OR EXISTS (SELECT 1 FROM todolist_project_members AS pm2 WHERE pm2.project_id = project.parent_id AND pm2.userid = :requester6)
                    ))
                )
            ORDER BY {$order}{$limitSql}";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        if ($scope !== 'team') {
            $req->bindParam(':requester', $this->userid, PDO::PARAM_INT);
        }
        if ($scope === 'all') {
            $req->bindParam(':requester2', $this->userid, PDO::PARAM_INT);
        }
        // a task tied to a project is only visible to that project's
        // creator/members (or the parent project's creator/members for
        // subproject tasks), regardless of scope
        $req->bindParam(':requester3', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester4', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester5', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester6', $this->userid, PDO::PARAM_INT);
        if ($completedSince !== null) {
            $req->bindValue(':completed_since', $completedSince, PDO::PARAM_STR);
        }
        if ($projectId !== null) {
            $req->bindParam(':filter_project_id', $projectId, PDO::PARAM_INT);
            if ($includeSubprojects) {
                $req->bindParam(':filter_project_id_subprojects', $projectId, PDO::PARAM_INT);
            }
        }
        if ($priorityFilter !== '') {
            $req->bindValue(':priority', $priority, PDO::PARAM_STR);
        }
        foreach ($searchBind as $name => $value) {
            $req->bindValue(':' . $name, $value, PDO::PARAM_STR);
        }
        $this->Db->execute($req);

        return array_map(fn(array $row): array => $this->decodeEntityLinks($this->decodeAssignees($row)), $req->fetchAll());
    }

    /**
     * Open/done totals for the "% done" progress bar, independent of
     * whatever page of the actual task list is currently loaded (the
     * board's own list fetch stays capped -- see readAll()'s $limit -- so
     * computing that percentage from however many rows happen to be loaded
     * would go quietly wrong past that cap, exactly the same way the count
     * of visible tasks itself would).
     *
     * Scoped to $projectId (or to project_id IS NULL if $unfiled) when
     * given, so the percentage tracks whichever project tab is selected --
     * without that, switching from "All" to a specific project would keep
     * showing the whole team's percentage, silently not matching what's
     * actually on screen. Deliberately still ignores the client-side
     * priority/search/Assigned-Created-All-tab filters layered on top in
     * the board: those aren't reflected in team_open_count/team_done_count
     * either, so the caller can label the figure accordingly rather than
     * imply it's a live count of whatever's currently filtered into view.
     *
     * team_open_count/team_done_count are the unscoped team-wide totals
     * regardless of $projectId/$unfiled, from the same query -- used to
     * tell whether the (always team-wide, never project-scoped) task list
     * fetch has more pages available, independent of which project is
     * being viewed.
     *
     * No assignee/entity-link subqueries, no LIMIT: this is one aggregate
     * query over indexed columns regardless of how much history exists.
     *
     * @return array{open_count: int, done_count: int, team_open_count: int, team_done_count: int}
     */
    private function readCounts(string $scope, string $scopeFilter, ?int $projectId, bool $unfiled, bool $includeSubprojects = false): array
    {
        $scopedCase = '';
        if ($projectId !== null && $includeSubprojects) {
            $scopedCase = ' AND (t.project_id = :project_id OR t.project_id IN (SELECT id FROM todolist_projects WHERE parent_id = :project_id_subprojects))';
        } elseif ($projectId !== null) {
            $scopedCase = ' AND t.project_id = :project_id';
        } elseif ($unfiled) {
            $scopedCase = ' AND t.project_id IS NULL';
        }
        $sql = "SELECT
                SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS team_open_count,
                SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS team_done_count,
                SUM(CASE WHEN t.completed_at IS NULL{$scopedCase} THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN t.completed_at IS NOT NULL{$scopedCase} THEN 1 ELSE 0 END) AS done_count
            FROM todolist AS t
            LEFT JOIN todolist_projects AS project ON project.id = t.project_id
            WHERE t.team = :team{$scopeFilter}
                AND (t.project_id IS NULL OR project.archived = 0)
                AND (
                    t.project_id IS NULL
                    OR project.userid = :requester3
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = t.project_id AND pm.userid = :requester4)
                    OR (project.parent_id IS NOT NULL AND (
                        EXISTS (SELECT 1 FROM todolist_projects AS pp WHERE pp.id = project.parent_id AND pp.userid = :requester5)
                        OR EXISTS (SELECT 1 FROM todolist_project_members AS pm2 WHERE pm2.project_id = project.parent_id AND pm2.userid = :requester6)
                    ))
                )";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        if ($scope !== 'team') {
            $req->bindParam(':requester', $this->userid, PDO::PARAM_INT);
        }
        if ($scope === 'all') {
            $req->bindParam(':requester2', $this->userid, PDO::PARAM_INT);
        }
        if ($projectId !== null) {
            $req->bindParam(':project_id', $projectId, PDO::PARAM_INT);
            if ($includeSubprojects) {
                $req->bindParam(':project_id_subprojects', $projectId, PDO::PARAM_INT);
            }
        }
        $req->bindParam(':requester3', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester4', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester5', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester6', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        return array(
            'open_count' => (int) $row['open_count'],
            'done_count' => (int) $row['done_count'],
            'team_open_count' => (int) $row['team_open_count'],
            'team_done_count' => (int) $row['team_done_count'],
        );
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
                t.creation_time, t.ordering, t.userid, t.team, t.assigned_userid, t.project_id, t.in_progress, t.priority, t.column_id, t.pinned,
                CONCAT(creator.firstname, ' ', creator.lastname) AS creator_fullname,
                CONCAT(assignee.firstname, ' ', assignee.lastname) AS assigned_fullname,
                project.name AS project_name,
                parent_project.name AS project_parent_name,
                col.kind AS column_kind,
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
            LEFT JOIN todolist_projects AS parent_project ON parent_project.id = project.parent_id
            LEFT JOIN todolist_columns AS col ON col.id = t.column_id
            WHERE t.id = :id AND t.team = :team
                AND (
                    t.project_id IS NULL
                    OR project.userid = :requester
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = t.project_id AND pm.userid = :requester2)
                )";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':requester', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':requester2', $this->userid, PDO::PARAM_INT);
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
        $before = $this->readOne();
        $previousAssignees = array_map('intval', array_column($before['assignees'] ?? array(), 'userid'));
        $previousColumnKind = $before['column_kind'] ?? null;
        foreach ($params as $key => $value) {
            if ($key === 'assignee_userids' || $key === 'assigned_userid' || $key === 'column_id') {
                continue;
            }
            $this->update($key, $value);
        }
        // Each project can have its own private copy of the columns (see
        // TodolistColumns::ensureProjectColumns()), so an explicit
        // column_id in the request isn't trusted as literally correct on
        // its own -- same reasoning as postAction() for a brand-new task:
        // it might belong to whatever column set the client happened to
        // have loaded (e.g. the All tab's team-wide default columns, or a
        // different project's board) rather than this task's own project.
        // Resolves to the equivalent column, by kind, within the task's
        // actual project -- its new one if project_id is also changing in
        // this same request, otherwise whatever it already was.
        $effectiveProjectId = array_key_exists('project_id', $params)
            ? ($params['project_id'] !== null && $params['project_id'] !== '' ? (int) $params['project_id'] : null)
            : ($before['project_id'] ?? null);
        if (array_key_exists('column_id', $params)) {
            $requestedKind = $this->getColumnKind($this->getColumnId($params['column_id'])) ?? $previousColumnKind;
            if ($requestedKind !== null) {
                $resolvedColumnId = $this->resolveColumnIdForKind($requestedKind, $effectiveProjectId);
                if ($resolvedColumnId !== null) {
                    $this->update('column_id', $resolvedColumnId);
                }
            }
        } elseif (array_key_exists('project_id', $params) && $previousColumnKind !== null) {
            $matchingColumnId = $this->resolveColumnIdForKind($previousColumnKind, $effectiveProjectId);
            if ($matchingColumnId !== null) {
                $this->update('column_id', $matchingColumnId);
            }
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
     * A task can be managed by whoever created it, whoever it's assigned to,
     * a team admin, or -- if it's in a project -- anyone who's a member of
     * that project (the same people who can already see it there).
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
        $isProjectMember = $task['project_id'] !== null && $this->isProjectMember((int) $task['project_id']);
        if (!$isCreator && !$isAssignee && !$isProjectMember && !$this->requester->isAdmin) {
            throw new IllegalActionException('User tried to modify a task that is not theirs.');
        }
    }

    private function isProjectMember(int $projectId): bool
    {
        $sql = 'SELECT COUNT(*) AS count FROM todolist_projects AS p
            LEFT JOIN todolist_project_members AS m ON m.project_id = p.id AND m.userid = :userid
            WHERE p.id = :project_id AND p.team = :team AND (p.userid = :userid2 OR m.userid IS NOT NULL)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':userid2', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $this->Db->fetch($req)['count'] > 0;
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
        $row['pinned'] = (bool) $row['pinned'];
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

    private function getColumnKind(int $columnId): ?string
    {
        $sql = 'SELECT kind FROM todolist_columns WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $columnId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->fetch($req)['kind'] ?? null;
    }

    /**
     * Each project can have its own private copy of the columns (see
     * TodolistColumns::ensureProjectColumns(), which this calls to create
     * that copy on first use), so a column id from one project's board --
     * or the team-wide default set -- is never valid for another project's.
     * Finds the equivalent column, by kind, within the given project scope
     * (null for the team-wide default set), returning null only if that
     * team somehow has no column of this kind at all.
     */
    private function resolveColumnIdForKind(string $kind, ?int $projectId): ?int
    {
        if ($projectId !== null) {
            (new TodolistColumns($this->requester))->ensureProjectColumns($projectId);
        }
        $sql = 'SELECT id FROM todolist_columns WHERE team = :team AND kind = :kind AND project_id '
            . ($projectId !== null ? '= :project_id' : 'IS NULL');
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':kind', $kind);
        if ($projectId !== null) {
            $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        }
        $this->Db->execute($req);
        $result = $req->fetch()['id'] ?? null;
        return $result !== null ? (int) $result : null;
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
                AND (c.project_id <=> t.project_id)
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
            'pinned' => array('pinned', Filter::toBinary($value), PDO::PARAM_INT),
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
