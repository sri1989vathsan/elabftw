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
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function _;
use function array_column;
use function array_key_exists;
use function array_map;
use function array_keys;
use function array_merge;
use function explode;
use function filter_var;
use function implode;
use function in_array;
use function max;
use function mb_strlen;
use function min;

use const FILTER_VALIDATE_INT;

/**
 * The free-form canvas of a project board: question cards and pointers to existing tasks and experiments,
 * placed at x/y in the space of the project they belong to. Reading a project can include its subprojects,
 * which is what lets several of them be shown together.
 */
final class TodolistCanvas extends AbstractRest
{
    use SetIdTrait;

    private const array TYPES = array('question', 'task', 'experiment');

    private const int COORDINATE_LIMIT = 20000;

    private int $team;

    private int $userid;

    public function __construct(private Users $requester, ?int $id = null)
    {
        parent::__construct();
        $this->team = (int) $this->requester->userData['team'];
        $this->userid = (int) $this->requester->userData['userid'];
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/todolist_canvas/';
    }

    /**
     * Cards and arrows of one project, and of its subprojects when include_subprojects=1.
     * Only the projects the requester can open are included.
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();
        $projectId = $this->getProjectId($query->getInt('project_id') ?: null);
        if ($projectId === null) {
            throw new ImproperActionException(_('A project is required.'));
        }
        $projectIds = array($projectId);
        if ($query->getInt('include_subprojects') === 1) {
            $req = $this->Db->prepare('SELECT id FROM todolist_projects WHERE parent_id = :parent AND team = :team AND archived = 0');
            $req->bindValue(':parent', $projectId, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
            $projectIds = array_merge($projectIds, array_map('intval', array_column($req->fetchAll(), 'id')));
        }
        $placeholders = implode(',', array_map(fn(int $i): string => ':p' . $i, array_keys($projectIds)));
        $sql = $this->nodeSelect() . ' WHERE n.team = :team AND n.project_id IN (' . $placeholders . ') ORDER BY n.id ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        foreach ($projectIds as $i => $id) {
            $req->bindValue(':p' . $i, $id, PDO::PARAM_INT);
        }
        $this->Db->execute($req);
        $nodes = array_map($this->shapeNode(...), $req->fetchAll());

        $nodeIds = array_map(fn(array $node): int => $node['id'], $nodes);
        $edges = array();
        if ($nodeIds !== array()) {
            $in = implode(',', array_map(fn(int $i): string => ':n' . $i, array_keys($nodeIds)));
            $req = $this->Db->prepare('SELECT id, from_node, to_node FROM todolist_canvas_edges WHERE team = :team AND (from_node IN (' . $in . ') OR to_node IN (' . $in . ')) ORDER BY id ASC');
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            foreach ($nodeIds as $i => $id) {
                $req->bindValue(':n' . $i, $id, PDO::PARAM_INT);
            }
            $this->Db->execute($req);
            $edges = array_map(fn(array $row): array => array(
                'id' => (int) $row['id'],
                'from_node' => (int) $row['from_node'],
                'to_node' => (int) $row['to_node'],
            ), $req->fetchAll());
        }

        return array('nodes' => $nodes, 'edges' => $edges);
    }

    #[Override]
    public function readOne(): array
    {
        $req = $this->Db->prepare($this->nodeSelect() . ' WHERE n.id = :id AND n.team = :team');
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        if ($row === false) {
            return array();
        }
        $this->assertProjectAccess((int) $row['project_id']);

        return $this->shapeNode($row);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $projectId = $this->getProjectId($reqBody['project_id'] ?? null);
        if ($projectId === null) {
            throw new ImproperActionException(_('A project is required.'));
        }
        $type = (string) ($reqBody['type'] ?? '');
        if (!in_array($type, self::TYPES, true)) {
            throw new ImproperActionException(_('Unknown card type.'));
        }
        $title = null;
        $note = null;
        $taskId = null;
        $entityId = null;
        if ($type === 'question') {
            $title = $this->getTitle($reqBody['title'] ?? '');
            $note = $this->getNote($reqBody['note'] ?? null);
        } elseif ($type === 'task') {
            $taskId = $this->getTaskId($reqBody['task_id'] ?? null);
            $this->assertNotOnCanvas($projectId, 'task_id', $taskId);
        } else {
            $entityId = $this->getExperimentId($reqBody['entity_id'] ?? null);
            $this->assertNotOnCanvas($projectId, 'entity_id', $entityId);
        }
        $sql = 'INSERT INTO todolist_canvas_nodes (team, project_id, type, x, y, title, note, task_id, entity_id, created_by)
            VALUES (:team, :project_id, :type, :x, :y, :title, :note, :task_id, :entity_id, :created_by)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        $req->bindValue(':type', $type);
        $req->bindValue(':x', $this->getCoordinate($reqBody['x'] ?? 0), PDO::PARAM_INT);
        $req->bindValue(':y', $this->getCoordinate($reqBody['y'] ?? 0), PDO::PARAM_INT);
        $req->bindValue(':title', $title, $title === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':note', $note, $note === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':task_id', $taskId, $taskId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':entity_id', $entityId, $entityId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindParam(':created_by', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $node = $this->readOne();
        if (empty($node)) {
            throw new ImproperActionException(_('Card not found.'));
        }
        if (array_key_exists('x', $params) || array_key_exists('y', $params)) {
            $req = $this->Db->prepare('UPDATE todolist_canvas_nodes SET x = :x, y = :y WHERE id = :id AND team = :team');
            $req->bindValue(':x', $this->getCoordinate($params['x'] ?? $node['x']), PDO::PARAM_INT);
            $req->bindValue(':y', $this->getCoordinate($params['y'] ?? $node['y']), PDO::PARAM_INT);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if ($node['type'] === 'question' && (array_key_exists('title', $params) || array_key_exists('note', $params))) {
            $req = $this->Db->prepare('UPDATE todolist_canvas_nodes SET title = :title, note = :note WHERE id = :id AND team = :team');
            $req->bindValue(':title', $this->getTitle($params['title'] ?? $node['title']));
            $note = $this->getNote(array_key_exists('note', $params) ? $params['note'] : $node['note']);
            $req->bindValue(':note', $note, $note === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (($params['convert_to_task'] ?? false) && $node['type'] === 'question') {
            $this->convertToTask($node);
        }

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        if (empty($this->readOne())) {
            throw new ImproperActionException(_('Card not found.'));
        }
        // the arrows of the card go with it (also enforced by the foreign keys)
        $req = $this->Db->prepare('DELETE FROM todolist_canvas_nodes WHERE id = :id AND team = :team');
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /** Used by the arrows endpoint: the requester must be able to open the card's project. */
    public function assertNodeAccess(int $nodeId): void
    {
        $req = $this->Db->prepare('SELECT project_id FROM todolist_canvas_nodes WHERE id = :id AND team = :team');
        $req->bindValue(':id', $nodeId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        if ($row === false) {
            throw new ImproperActionException(_('Card not found.'));
        }
        $this->assertProjectAccess((int) $row['project_id']);
    }

    /** The question becomes a real to-do task in the same project, and the card points at it from now on. */
    private function convertToTask(array $node): void
    {
        $taskId = (new Todolist($this->requester))->postAction(Action::Create, array(
            'content' => $node['title'] ?? '',
            'description' => $node['note'],
            'project_id' => $node['project_id'],
        ));
        $req = $this->Db->prepare('UPDATE todolist_canvas_nodes SET type = "task", task_id = :task_id, title = NULL, note = NULL WHERE id = :id AND team = :team');
        $req->bindValue(':task_id', $taskId, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function nodeSelect(): string
    {
        return 'SELECT n.id, n.project_id, n.type, n.x, n.y, n.title, n.note, n.task_id, n.entity_id,
                t.id AS t_id, t.body AS task_title, t.priority AS task_priority, t.deadline AS task_deadline,
                t.completed_at AS task_completed_at, t.in_progress AS task_in_progress, t.archived_at AS task_archived_at,
                col.name AS task_column, col.kind AS task_column_kind,
                (SELECT GROUP_CONCAT(CONCAT(u.firstname, " ", u.lastname) ORDER BY u.userid SEPARATOR "|")
                    FROM todolist_task_assignees AS ta INNER JOIN users AS u ON u.userid = ta.userid
                    WHERE ta.task_id = t.id) AS task_assignees,
                (SELECT COUNT(*) FROM custom_todolist_steps WHERE task_id = t.id) AS task_steps_total,
                (SELECT COALESCE(SUM(finished), 0) FROM custom_todolist_steps WHERE task_id = t.id) AS task_steps_done,
                (SELECT COUNT(*) FROM custom_todolist_comments WHERE task_id = t.id) AS task_comments,
                e.title AS exp_title, e.date AS exp_date, st.title AS exp_status, st.color AS exp_status_color
            FROM todolist_canvas_nodes AS n
            LEFT JOIN todolist AS t ON t.id = n.task_id AND t.team = n.team
            LEFT JOIN todolist_columns AS col ON col.id = t.column_id
            LEFT JOIN experiments AS e ON n.type = "experiment" AND e.id = n.entity_id AND e.team = n.team
            LEFT JOIN experiments_status AS st ON st.id = e.status';
    }

    private function shapeNode(array $row): array
    {
        $node = array(
            'id' => (int) $row['id'],
            'project_id' => (int) $row['project_id'],
            'type' => $row['type'],
            'x' => (int) $row['x'],
            'y' => (int) $row['y'],
            'title' => $row['title'],
            'note' => $row['note'],
            'task_id' => $row['task_id'] !== null ? (int) $row['task_id'] : null,
            'entity_id' => $row['entity_id'] !== null ? (int) $row['entity_id'] : null,
        );
        if ($row['type'] === 'task') {
            // a task that no longer exists (or was archived) leaves a placeholder card
            $node['task'] = $row['t_id'] === null ? null : array(
                'id' => (int) $row['t_id'],
                'title' => $row['task_title'],
                'priority' => $row['task_priority'],
                'deadline' => $row['task_deadline'],
                'completed_at' => $row['task_completed_at'],
                'in_progress' => (bool) $row['task_in_progress'],
                'archived' => $row['task_archived_at'] !== null,
                'column' => $row['task_column'],
                'column_kind' => $row['task_column_kind'],
                'assignees' => $row['task_assignees'] === null || $row['task_assignees'] === '' ? array() : explode('|', (string) $row['task_assignees']),
                'steps_total' => (int) $row['task_steps_total'],
                'steps_done' => (int) $row['task_steps_done'],
                'comments' => (int) $row['task_comments'],
            );
        }
        if ($row['type'] === 'experiment') {
            $node['experiment'] = $row['exp_title'] === null ? null : array(
                'id' => (int) $row['entity_id'],
                'title' => $row['exp_title'],
                'date' => $row['exp_date'],
                'status' => $row['exp_status'],
                'status_color' => $row['exp_status_color'],
            );
        }

        return $node;
    }

    private function assertNotOnCanvas(int $projectId, string $column, int $value): void
    {
        $req = $this->Db->prepare('SELECT COUNT(*) AS count FROM todolist_canvas_nodes WHERE team = :team AND project_id = :project_id AND ' . $column . ' = :value');
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        $req->bindValue(':value', $value, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] > 0) {
            throw new ImproperActionException(_('This is already on the canvas.'));
        }
    }

    private function getProjectId(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $projectId = filter_var($value, FILTER_VALIDATE_INT);
        if ($projectId === false || $projectId <= 0) {
            throw new ImproperActionException(_('Invalid project id.'));
        }
        $this->assertProjectAccess((int) $projectId);

        return (int) $projectId;
    }

    private function getTaskId(mixed $value): int
    {
        $taskId = filter_var($value, FILTER_VALIDATE_INT);
        if ($taskId === false || $taskId <= 0) {
            throw new ImproperActionException(_('A task is required.'));
        }
        $req = $this->Db->prepare('SELECT COUNT(*) AS count FROM todolist WHERE id = :id AND team = :team');
        $req->bindValue(':id', $taskId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException(_('Task not found.'));
        }

        return (int) $taskId;
    }

    private function getExperimentId(mixed $value): int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT);
        if ($id === false || $id <= 0) {
            throw new ImproperActionException(_('An experiment is required.'));
        }
        $req = $this->Db->prepare('SELECT COUNT(*) AS count FROM experiments WHERE id = :id AND team = :team');
        $req->bindValue(':id', $id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException(_('Experiment not found.'));
        }

        return (int) $id;
    }

    private function getTitle(mixed $value): string
    {
        $title = Filter::toPureString((string) $value);
        if ($title === '' || mb_strlen($title) > 255) {
            throw new ImproperActionException(_('A question needs a title of at most 255 characters.'));
        }

        return $title;
    }

    private function getNote(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $note = Filter::toPureString((string) $value);

        return mb_strlen($note) > 5000 ? throw new ImproperActionException(_('A note can have at most 5000 characters.')) : $note;
    }

    private function getCoordinate(mixed $value): int
    {
        $coordinate = filter_var($value, FILTER_VALIDATE_INT);

        return $coordinate === false ? 0 : max(-self::COORDINATE_LIMIT, min(self::COORDINATE_LIMIT, (int) $coordinate));
    }

    private function assertProjectAccess(int $projectId): void
    {
        $sql = 'SELECT COUNT(*) AS count FROM todolist_projects AS p
            WHERE p.id = :id AND p.team = :team
                AND (
                    p.userid = :userid
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = p.id AND pm.userid = :userid2)
                    OR (p.parent_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM todolist_projects AS parent
                        WHERE parent.id = p.parent_id
                            AND (
                                parent.userid = :userid3
                                OR EXISTS (SELECT 1 FROM todolist_project_members AS ppm WHERE ppm.project_id = parent.id AND ppm.userid = :userid4)
                            )
                    ))
                )';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $projectId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid2', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid3', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid4', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException(_('Project not found or access denied.'));
        }
    }
}
