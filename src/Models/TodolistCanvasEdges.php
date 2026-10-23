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
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function _;
use function filter_var;

use const FILTER_VALIDATE_INT;

/**
 * The arrows between the cards of a project canvas (see TodolistCanvas). An arrow only exists between two
 * cards the requester can open; deleting a card removes its arrows by itself.
 */
final class TodolistCanvasEdges extends AbstractRest
{
    use SetIdTrait;

    private int $team;

    private TodolistCanvas $Canvas;

    public function __construct(private Users $requester, ?int $id = null)
    {
        parent::__construct();
        $this->team = (int) $this->requester->userData['team'];
        $this->Canvas = new TodolistCanvas($this->requester);
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/todolist_canvas_edges/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $from = $this->getNodeId($reqBody['from_node'] ?? null);
        $to = $this->getNodeId($reqBody['to_node'] ?? null);
        if ($from === $to) {
            throw new ImproperActionException(_('A card cannot point to itself.'));
        }
        $this->Canvas->assertNodeAccess($from);
        $this->Canvas->assertNodeAccess($to);
        $req = $this->Db->prepare('SELECT id FROM todolist_canvas_edges WHERE team = :team AND from_node = :from AND to_node = :to');
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':from', $from, PDO::PARAM_INT);
        $req->bindValue(':to', $to, PDO::PARAM_INT);
        $this->Db->execute($req);
        $existing = $this->Db->fetch($req);
        if ($existing !== false) {
            return (int) $existing['id'];
        }
        $req = $this->Db->prepare('INSERT INTO todolist_canvas_edges (team, from_node, to_node) VALUES (:team, :from, :to)');
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $req->bindValue(':from', $from, PDO::PARAM_INT);
        $req->bindValue(':to', $to, PDO::PARAM_INT);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function destroy(): bool
    {
        $req = $this->Db->prepare('SELECT from_node FROM todolist_canvas_edges WHERE id = :id AND team = :team');
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $this->Db->fetch($req);
        if ($row === false) {
            throw new ImproperActionException(_('Arrow not found.'));
        }
        $this->Canvas->assertNodeAccess((int) $row['from_node']);
        $req = $this->Db->prepare('DELETE FROM todolist_canvas_edges WHERE id = :id AND team = :team');
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function getNodeId(mixed $value): int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT);
        if ($id === false || $id <= 0) {
            throw new ImproperActionException(_('Invalid card id.'));
        }

        return (int) $id;
    }
}
