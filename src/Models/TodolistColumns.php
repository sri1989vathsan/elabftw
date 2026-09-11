<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function _;
use function array_key_exists;
use function array_map;
use function filter_var;
use function mb_strlen;

use const FILTER_VALIDATE_INT;

/**
 * User-configurable Kanban columns for the project management board. Every
 * team starts with three built-in columns (To do / In progress / Done,
 * "kind" fixed) -- Todolist::patch() keeps a task's legacy completed_at/
 * in_progress fields in sync whenever it moves into one of those three, so
 * the sidebar widget, calendar and notifications (which only know about
 * those two fields) keep working unmodified. Anyone can add more custom
 * columns in between; only custom ones can be renamed away from their kind
 * semantics or deleted.
 */
final class TodolistColumns extends AbstractRest
{
    use SetIdTrait;

    private int $team;

    public function __construct(private Users $requester, ?int $id = null)
    {
        parent::__construct();
        $this->team = (int) $this->requester->userData['team'];
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/todolist_columns/';
    }

    /**
     * Seed the three built-in columns for a newly created team. Called from
     * Teams::create(); existing teams got theirs from the migration.
     *
     * On a brand-new install, Teams::create() (and this) runs as part of
     * the official db:install step, which happens before our custom
     * migrations -- so the table itself may not exist yet. In that case,
     * no-op here: migration 034 seeds this team's columns for every team
     * missing them once custom:db:update runs right after.
     */
    public static function createDefault(int $team): void
    {
        $Db = Db::getConnection();
        $existsReq = $Db->prepare('SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name');
        $existsReq->bindValue(':table_name', 'todolist_columns');
        $Db->execute($existsReq);
        if ((int) $Db->fetch($existsReq)['count'] === 0) {
            return;
        }
        $sql = 'INSERT INTO todolist_columns (team, name, kind, ordering) VALUES
            (:team, :name0, "todo", 0),
            (:team2, :name1, "in_progress", 1),
            (:team3, :name2, "done", 2)';
        $req = $Db->prepare($sql);
        $req->bindValue(':team', $team, PDO::PARAM_INT);
        $req->bindValue(':team2', $team, PDO::PARAM_INT);
        $req->bindValue(':team3', $team, PDO::PARAM_INT);
        $req->bindValue(':name0', _('To do'));
        $req->bindValue(':name1', _('In progress'));
        $req->bindValue(':name2', _('Done'));
        $Db->execute($req);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $name = $this->getName($reqBody['name'] ?? '');
        $projectId = $this->getProjectId($reqBody['project_id'] ?? null);
        if ($projectId !== null) {
            $this->ensureProjectColumns($projectId);
        }
        $sql = 'INSERT INTO todolist_columns (team, project_id, name, kind, ordering)
            SELECT :team, :project_id, :name, "custom", COALESCE(MAX(ordering), -1) + 1
            FROM todolist_columns WHERE team = :team2 AND project_id ' . ($projectId !== null ? '= :project_id2' : 'IS NULL');
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':team2', $this->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, $projectId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        if ($projectId !== null) {
            $req->bindValue(':project_id2', $projectId, PDO::PARAM_INT);
        }
        $req->bindValue(':name', $name);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $projectId = $this->getProjectId($queryParams->getQuery()->getInt('project_id') ?: null);
        if ($projectId !== null) {
            $this->ensureProjectColumns($projectId);
        }
        $sql = 'SELECT id, name, kind, ordering, hidden FROM todolist_columns
            WHERE team = :team AND project_id ' . ($projectId !== null ? '= :project_id' : 'IS NULL') . '
            ORDER BY ordering ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        if ($projectId !== null) {
            $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        }
        $this->Db->execute($req);

        return array_map(fn(array $row): array => array(...$row, 'hidden' => (bool) $row['hidden']), $req->fetchAll());
    }

    /**
     * A project's board gets its own copy of the columns the first time it
     * is opened, seeded from the team's defaults -- a no-op once it has any.
     * Also called from Todolist::patch() when a task is assigned to a
     * project it didn't already belong to, so its column_id can follow it.
     */
    public function ensureProjectColumns(int $projectId): void
    {
        $sql = 'SELECT COUNT(*) AS count FROM todolist_columns WHERE team = :team AND project_id = :project_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] > 0) {
            return;
        }
        $sql = 'INSERT INTO todolist_columns (team, project_id, name, kind, ordering, hidden)
            SELECT team, :project_id, name, kind, ordering, hidden
            FROM todolist_columns
            WHERE team = :team AND project_id IS NULL';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':project_id', $projectId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        // move this project's existing tasks off the team-wide default
        // columns and onto their board's own new copies, matched by kind
        $sql = 'UPDATE todolist AS t
            INNER JOIN todolist_columns AS old_col ON old_col.id = t.column_id AND old_col.project_id IS NULL
            INNER JOIN todolist_columns AS new_col ON new_col.team = old_col.team
                AND new_col.project_id = :project_id2 AND new_col.kind = old_col.kind
            SET t.column_id = new_col.id
            WHERE t.project_id = :project_id3 AND t.team = :team2';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':project_id2', $projectId, PDO::PARAM_INT);
        $req->bindValue(':project_id3', $projectId, PDO::PARAM_INT);
        $req->bindParam(':team2', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function getProjectId(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $projectId = filter_var($value, FILTER_VALIDATE_INT);
        if ($projectId === false || $projectId <= 0) {
            return null;
        }
        $sql = 'SELECT COUNT(*) AS count FROM todolist_projects WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $projectId, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            return null;
        }

        return $projectId;
    }

    #[Override]
    public function readOne(): array
    {
        $sql = 'SELECT id, name, kind, ordering, project_id, hidden FROM todolist_columns WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        if ($row === false) {
            return array();
        }
        $row['hidden'] = (bool) $row['hidden'];
        return $row;
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        if (array_key_exists('name', $params)) {
            $sql = 'UPDATE todolist_columns SET name = :name WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':name', $this->getName($params['name']));
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('ordering', $params)) {
            $sql = 'UPDATE todolist_columns SET ordering = :ordering WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':ordering', (int) $params['ordering'], PDO::PARAM_INT);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }
        if (array_key_exists('hidden', $params)) {
            $sql = 'UPDATE todolist_columns SET hidden = :hidden WHERE id = :id AND team = :team';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':hidden', Filter::toBinary($params['hidden']), PDO::PARAM_INT);
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $req->bindParam(':team', $this->team, PDO::PARAM_INT);
            $this->Db->execute($req);
        }

        return $this->readOne();
    }

    // Any column -- including the three built-ins -- can now be deleted, as
    // long as it isn't the last one left on its board (team-wide, or a
    // project's own copy): findColumnByKind()/resolveColumnIdForKind() in
    // Todolist.php already tolerate a missing kind gracefully (falling back
    // to whatever column a task is explicitly given), so nothing there
    // needs to change for a "todo"/"in_progress"/"done" column to go away.
    #[Override]
    public function destroy(): bool
    {
        $column = $this->readOne();
        if (empty($column)) {
            throw new ImproperActionException('Column not found.');
        }
        $projectId = $column['project_id'] !== null ? (int) $column['project_id'] : null;

        // the fallback target: whichever remaining column on this same
        // board (team-wide, or this project's own set) sorts first --
        // arbitrary but deterministic, and doesn't assume a "todo" column
        // still exists the way the old custom-only version could
        $sql = 'SELECT id, kind FROM todolist_columns
            WHERE team = :team AND (project_id <=> :project_id) AND id != :id
            ORDER BY ordering ASC LIMIT 1';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $projectId, $projectId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $target = $this->Db->fetch($req);
        if ($target === false) {
            throw new ImproperActionException('At least one column must remain on this board.');
        }

        // move any tasks out of the column being removed into that target,
        // keeping the legacy completed_at/in_progress fields in sync with
        // wherever they land -- same rule Todolist::syncStatusFromColumn()
        // applies whenever a task is moved between columns directly
        $sql = 'UPDATE todolist SET
                column_id = :target_id,
                completed_at = CASE WHEN :target_kind = "done" THEN COALESCE(completed_at, UTC_TIMESTAMP()) ELSE NULL END,
                in_progress = :in_progress
            WHERE column_id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':target_id', $target['id'], PDO::PARAM_INT);
        $req->bindValue(':target_kind', $target['kind']);
        $req->bindValue(':in_progress', $target['kind'] === 'in_progress', PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        $sql = 'DELETE FROM todolist_columns WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function getName(mixed $value): string
    {
        $name = Filter::toPureString((string) $value);
        if ($name === '' || mb_strlen($name) > 100) {
            throw new ImproperActionException('A column name is required and must be shorter than 100 characters.');
        }
        return $name;
    }
}
