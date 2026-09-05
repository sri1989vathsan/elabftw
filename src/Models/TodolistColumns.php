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
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function _;
use function array_key_exists;
use function mb_strlen;

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
     */
    public static function createDefault(int $team): void
    {
        $Db = Db::getConnection();
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
        $sql = 'INSERT INTO todolist_columns (team, name, kind, ordering)
            SELECT :team, :name, "custom", COALESCE(MAX(ordering), -1) + 1
            FROM todolist_columns WHERE team = :team2';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':team2', $this->team, PDO::PARAM_INT);
        $req->bindValue(':name', $name);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT id, name, kind, ordering FROM todolist_columns WHERE team = :team ORDER BY ordering ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $column) {
            if ((int) $column['id'] === $this->id) {
                return $column;
            }
        }
        throw new ResourceNotFoundException();
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

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $column = $this->readOne();
        if ($column['kind'] !== 'custom') {
            throw new ImproperActionException('The default columns cannot be deleted.');
        }
        // move any tasks out of the column being removed into the team's
        // "To do" column rather than leaving them pointing at a dead id
        $sql = "UPDATE todolist AS t
            INNER JOIN todolist_columns AS target ON target.team = :team AND target.kind = 'todo'
            SET t.column_id = target.id
            WHERE t.column_id = :id AND t.team = :team2";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindParam(':team2', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        $sql = "DELETE FROM todolist_columns WHERE id = :id AND team = :team AND kind = 'custom'";
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
