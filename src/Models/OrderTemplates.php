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
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_map;
use function mb_strlen;
use function preg_replace;
use function trim;

/**
 * Shared text templates that go with ordering (an email to a supplier, a quote request, ...).
 * They are not part of an order: the whole team reads and copies from them, and only the
 * author or a team admin edits or deletes one.
 */
final class OrderTemplates extends AbstractRest
{
    use SetIdTrait;

    private const int MAX_BODY = 20000;

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/order_templates/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $title = $this->getTitle($reqBody['title'] ?? '');
        $body = $this->getBody($reqBody['body'] ?? null);
        $sql = 'INSERT INTO custom_order_templates (team, userid, title, body) VALUES (:team, :userid, :title, :body)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = self::selectSql() . ' WHERE t.team = :team ORDER BY t.title ASC, t.id ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        $sql = self::selectSql() . ' WHERE t.id = :id AND t.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $req->fetch();
        if ($row === false) {
            throw new ResourceNotFoundException();
        }

        return $this->hydrate($row);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $template = $this->readOne();
        $this->assertCanEdit($template);
        $title = array_key_exists('title', $params) ? $this->getTitle($params['title']) : $template['title'];
        $body = array_key_exists('body', $params) ? $this->getBody($params['body']) : $template['body'];
        $sql = 'UPDATE custom_order_templates SET title = :title, body = :body WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->assertCanEdit($this->readOne());
        $sql = 'DELETE FROM custom_order_templates WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private static function selectSql(): string
    {
        return 'SELECT t.id, t.title, t.body, t.userid, t.created_at, t.updated_at,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_order_templates AS t
            LEFT JOIN users AS author ON author.userid = t.userid';
    }

    /** @param array<string, mixed> $row */
    private function hydrate(array $row): array
    {
        $row['id'] = (int) $row['id'];
        $row['userid'] = (int) $row['userid'];
        $row['can_edit'] = $row['userid'] === $this->Users->userid || $this->Users->isAdmin;

        return $row;
    }

    /** @param array<string, mixed> $template */
    private function assertCanEdit(array $template): void
    {
        if (!$template['can_edit']) {
            throw new ImproperActionException('Only the author or a team admin can change this template.');
        }
    }

    private function getTitle(mixed $value): string
    {
        $title = trim(preg_replace('/\s+/', ' ', (string) $value) ?? '');
        if ($title === '' || mb_strlen($title) > 255) {
            throw new ImproperActionException('A title is required and must be shorter than 255 characters.');
        }

        return $title;
    }

    /** Plain text, kept exactly as typed (including <placeholders>): it is only shown escaped and copied, never rendered as HTML. */
    private function getBody(mixed $value): ?string
    {
        $body = trim((string) ($value ?? ''));
        if ($body === '') {
            return null;
        }
        if (mb_strlen($body) > self::MAX_BODY) {
            throw new ImproperActionException('The text must be shorter than ' . self::MAX_BODY . ' characters.');
        }

        return $body;
    }
}
