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
use Override;
use PDO;

use function _;
use function array_key_exists;
use function array_map;
use function array_unique;
use function array_values;
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
        $sql = 'INSERT INTO todolist_projects(team, name, description, userid) VALUES(:team, :name, :description, :userid)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':name', $name);
        $req->bindValue(':description', $description, $description === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
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
        $sql = "SELECT p.id, p.name, p.description, p.userid, p.created_at,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', u.userid, 'fullname', u.fullname))
                    FROM todolist_project_members AS m
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS u ON u.userid = m.userid
                    WHERE m.project_id = p.id
                ), JSON_ARRAY()) AS members
            FROM todolist_projects AS p
            WHERE p.team = :team
            ORDER BY p.name ASC";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_map(fn(array $row): array => $this->decodeMembers($row), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        $sql = "SELECT p.id, p.name, p.description, p.userid, p.created_at,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('userid', u.userid, 'fullname', u.fullname))
                    FROM todolist_project_members AS m
                    INNER JOIN (SELECT userid, CONCAT(firstname, ' ', lastname) AS fullname FROM users) AS u ON u.userid = m.userid
                    WHERE m.project_id = p.id
                ), JSON_ARRAY()) AS members
            FROM todolist_projects AS p
            WHERE p.id = :id AND p.team = :team";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
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
        if ((int) $project['userid'] !== $this->userid && !$this->requester->isAdmin) {
            throw new IllegalActionException('User tried to modify a project they did not create.');
        }
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
        $description = Filter::toPureString((string) $value);
        if (mb_strlen($description) > 500) {
            throw new ImproperActionException(_('Project description must be shorter than 500 characters.'));
        }
        return $description;
    }
}
