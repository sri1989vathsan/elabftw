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
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use DateTimeImmutable;
use Override;
use PDO;

use function _;
use function array_key_exists;
use function array_map;
use function array_unique;
use function array_values;
use function in_array;
use function is_array;
use function json_decode;
use function mb_strlen;
use function trim;

use const JSON_THROW_ON_ERROR;

/**
 * Project boards for the assignable to-do list: a named group of tasks with
 * a short description and a set of team members who can be assigned within it.
 */
final class TodolistProjects extends AbstractRest
{
    use SetIdTrait;

    private const array STATUSES = array('planning', 'active', 'on_hold', 'done');

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
        return 'api/v2/todolist_projects/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $name = $this->getName($reqBody['name'] ?? '');
        $description = $this->getDescription($reqBody['description'] ?? null);
        $targetEndDate = $this->getTargetEndDate($reqBody['target_end_date'] ?? null);
        $status = $this->getStatus($reqBody['status'] ?? null);
        $parentId = $this->getParentId($reqBody['parent_id'] ?? null);
        // ordering is scoped per parent (NULL <=> NULL matches top-level
        // projects against each other) so a subproject's position among its
        // siblings doesn't collide with unrelated top-level projects
        $sql = 'INSERT INTO todolist_projects(team, name, description, target_end_date, status, userid, parent_id, ordering)
            SELECT :team, :name, :description, :target_end_date, :status, :userid, :parent_id, COALESCE(MAX(ordering), -1) + 1
            FROM todolist_projects WHERE team = :team2 AND (parent_id <=> :parent_id2)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':team2', $this->team, PDO::PARAM_INT);
        $req->bindParam(':name', $name);
        $req->bindValue(':description', $description, $description === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':target_end_date', $targetEndDate, $targetEndDate === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':status', $status);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':parent_id', $parentId, $parentId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':parent_id2', $parentId, $parentId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $this->Db->execute($req);
        $id = (int) $this->Db->lastInsertId();
        $this->setId($id);
        if (isset($reqBody['members']) && is_array($reqBody['members'])) {
            $this->syncMembers($id, $reqBody['members']);
        }
        return $id;
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        // Visible to: the project's creator or an explicit member -- not
        // automatically to a team admin, who has to be added like anyone
        // else to see or manage a project they're not part of.
        $showArchived = ($queryParams ?? $this->getQueryParams())->getQuery()->getBoolean('archived');
        $sql = "SELECT p.id, p.name, p.description, p.target_end_date, p.status, p.userid, p.created_at, p.archived, p.ordering, p.parent_id,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', u.userid, 'fullname', u.fullname))
                    FROM todolist_project_members AS m
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS u ON u.userid = m.userid
                    WHERE m.project_id = p.id
                ), JSON_ARRAY()) AS members
            FROM todolist_projects AS p
            WHERE p.team = :team
                AND p.archived = :archived
                AND (
                    p.userid = :userid
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = p.id AND pm.userid = :userid2)
                )
            ORDER BY p.ordering ASC, p.id ASC";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':archived', $showArchived ? 1 : 0, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid2', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_map(fn(array $row): array => $this->decodeMembers($row), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        // unlike readAll(), not filtered by archived state -- a single
        // project must stay reachable by id (e.g. to unarchive it) however
        // the list happens to be filtered right now
        $sql = "SELECT p.id, p.name, p.description, p.target_end_date, p.status, p.userid, p.created_at, p.archived, p.ordering, p.parent_id,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', u.userid, 'fullname', u.fullname))
                    FROM todolist_project_members AS m
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS u ON u.userid = m.userid
                    WHERE m.project_id = p.id
                ), JSON_ARRAY()) AS members
            FROM todolist_projects AS p
            WHERE p.id = :id AND p.team = :team
                AND (
                    p.userid = :userid
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = p.id AND pm.userid = :userid2)
                )";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid2', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        if ($row === false) {
            return array();
        }
        return $this->decodeMembers($row);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->canWriteOrExplode();
        if (array_key_exists('name', $params)) {
            $sql = 'UPDATE todolist_projects SET name = :name WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':name', $this->getName($params['name']));
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('description', $params)) {
            $sql = 'UPDATE todolist_projects SET description = :description WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $description = $this->getDescription($params['description']);
            $req->bindValue(':description', $description, $description === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('target_end_date', $params)) {
            $sql = 'UPDATE todolist_projects SET target_end_date = :target_end_date WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $targetEndDate = $this->getTargetEndDate($params['target_end_date']);
            $req->bindValue(':target_end_date', $targetEndDate, $targetEndDate === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('status', $params)) {
            $sql = 'UPDATE todolist_projects SET status = :status WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':status', $this->getStatus($params['status']));
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('archived', $params)) {
            $sql = 'UPDATE todolist_projects SET archived = :archived WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':archived', Filter::toBinary($params['archived']), PDO::PARAM_INT);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('ordering', $params)) {
            $sql = 'UPDATE todolist_projects SET ordering = :ordering WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':ordering', (int) $params['ordering'], PDO::PARAM_INT);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('members', $params) && is_array($params['members'])) {
            $this->syncMembers((int) $this->id, $params['members']);
        }
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->canWriteOrExplode();
        $sql = 'DELETE FROM todolist_projects WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Only the project's creator or a team admin can rename it, change its
     * description, edit membership, or delete it
     */
    private function canWriteOrExplode(): void
    {
        $project = $this->readOne();
        if (empty($project)) {
            throw new IllegalActionException('Project not found in this team.');
        }
        // readOne() above already only returns a project the requester is
        // the creator of or a member of -- getting this far means they
        // qualify, admin or not, so there's nothing further to check here.
    }

    /**
     * Replace the full membership list for this project with the given user ids,
     * restricted to members of the current team
     */
    private function syncMembers(int $projectId, array $memberIds): void
    {
        $ids = array_values(array_unique(array_map('intval', $memberIds)));
        $del = $this->Db->prepare('DELETE FROM todolist_project_members WHERE project_id = :project_id');
        $del->bindParam(':project_id', $projectId, PDO::PARAM_INT);
        $this->Db->execute($del);
        foreach ($ids as $memberId) {
            $checkSql = 'SELECT COUNT(*) AS count FROM users2teams WHERE users_id = :userid AND teams_id = :team';
            $check = $this->Db->prepare($checkSql);
            $check->bindParam(':userid', $memberId, PDO::PARAM_INT);
            $check->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($check);
            if ((int) $this->Db->fetch($check)['count'] === 0) {
                continue;
            }
            $insSql = 'INSERT INTO todolist_project_members(project_id, userid) VALUES(:project_id, :userid)';
            $ins = $this->Db->prepare($insSql);
            $ins->bindParam(':project_id', $projectId, PDO::PARAM_INT);
            $ins->bindParam(':userid', $memberId, PDO::PARAM_INT);
            $this->Db->execute($ins);
        }
    }

    private function decodeMembers(array $row): array
    {
        $row['members'] = json_decode((string) $row['members'], true, 512, JSON_THROW_ON_ERROR);
        return $row;
    }

    private function getName(mixed $value): string
    {
        $name = Filter::toPureString((string) $value);
        if ($name === '' || mb_strlen($name) > 255) {
            throw new ImproperActionException(_('A project name is required and must be shorter than 255 characters.'));
        }
        return $name;
    }

    private function getDescription(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        // Filter::body() (not toPureString()) so the rich text editor's
        // headings/lists/bold/etc. survive -- toPureString() strips all HTML.
        $description = Filter::body((string) $value);
        if (mb_strlen($description) > 10000) {
            throw new ImproperActionException(_('Project goals/description must be shorter than 10000 characters.'));
        }
        return $description;
    }

    private function getTargetEndDate(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $date = (string) $value;
        if (DateTimeImmutable::createFromFormat('Y-m-d', $date) === false) {
            throw new ImproperActionException(_('Invalid target end date.'));
        }
        return $date;
    }

    // subprojects are only one level deep: the referenced parent must
    // itself be top-level (its own parent_id NULL), and must be a project
    // this requester can already see (creator or member) -- same rule
    // readOne()/readAll() already apply to every project.
    private function getParentId(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $parentId = (int) $value;
        $sql = 'SELECT parent_id FROM todolist_projects AS p
            WHERE p.id = :id AND p.team = :team
                AND (
                    p.userid = :userid
                    OR EXISTS (SELECT 1 FROM todolist_project_members AS pm WHERE pm.project_id = p.id AND pm.userid = :userid2)
                )';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $parentId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':userid2', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        $parent = $this->Db->fetch($req);
        if ($parent === false) {
            throw new ImproperActionException(_('Parent project not found.'));
        }
        if ($parent['parent_id'] !== null) {
            throw new ImproperActionException(_('A subproject cannot itself have a subproject.'));
        }
        return $parentId;
    }

    private function getStatus(mixed $value): string
    {
        if ($value === null || $value === '') {
            return self::STATUSES[0];
        }
        $status = (string) $value;
        if (!in_array($status, self::STATUSES, true)) {
            throw new ImproperActionException(_('Invalid project status.'));
        }
        return $status;
    }
}
