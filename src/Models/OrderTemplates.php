<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Enums\Storage;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;
use RuntimeException;

use function array_map;
use function implode;
use function mb_strlen;
use function preg_replace;
use function sprintf;
use function trim;

/**
 * Shared text templates that go with ordering (an email to a supplier, a quote request, ...).
 * They are not part of an order: the whole team reads and copies from them, and only the
 * author or a team admin edits or deletes one.
 */
final class OrderTemplates extends AbstractRest
{
    use SetIdTrait;

    private const int MAX_BODY = 60000;

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

        $rows = $req->fetchAll();
        $uploads = $this->uploadsByTemplate(array_map(static fn(array $row): int => (int) $row['id'], $rows));

        return array_map(fn(array $row): array => $this->hydrate($row, $uploads[(int) $row['id']] ?? array()), $rows);
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

        return $this->hydrate($row, $this->uploadsByTemplate(array((int) $row['id']))[(int) $row['id']] ?? array());
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
        // the rows go with the template (foreign key); the stored files have to be removed by hand
        $files = $this->Db->prepare('SELECT storage, long_name FROM custom_order_template_uploads WHERE template_id = :id');
        $files->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($files);
        foreach ($files->fetchAll() as $file) {
            try {
                Storage::from((int) $file['storage'])->getStorage()->getFs()->delete($file['long_name']);
            } catch (RuntimeException) {
                // already gone
            }
        }
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

    /**
     * @param list<int> $ids
     * @return array<int, list<array<string, mixed>>> the attached files, keyed by template id
     */
    private function uploadsByTemplate(array $ids): array
    {
        if ($ids === array()) {
            return array();
        }
        $sql = sprintf(
            'SELECT id, template_id, real_name, long_name, storage, filesize FROM custom_order_template_uploads
                WHERE template_id IN (%s) ORDER BY created_at ASC, id ASC',
            implode(',', array_map('intval', $ids)),
        );
        $byTemplate = array();
        foreach ($this->Db->q($sql)->fetchAll() as $upload) {
            $byTemplate[(int) $upload['template_id']][] = array(
                'id' => (int) $upload['id'],
                'real_name' => $upload['real_name'],
                'long_name' => $upload['long_name'],
                'storage' => (int) $upload['storage'],
                'filesize' => $upload['filesize'] === null ? null : (int) $upload['filesize'],
            );
        }

        return $byTemplate;
    }

    /**
     * @param array<string, mixed> $row
     * @param list<array<string, mixed>> $uploads
     */
    private function hydrate(array $row, array $uploads = array()): array
    {
        $row['uploads'] = $uploads;
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

    /** Rich text (bullets, numbering, bold, ...) cleaned of anything unsafe before it is stored. */
    private function getBody(mixed $value): ?string
    {
        $body = trim((string) ($value ?? ''));
        if ($body === '' || trim(strip_tags($body)) === '') {
            return null;
        }
        if (mb_strlen($body) > self::MAX_BODY) {
            throw new ImproperActionException('The text must be shorter than ' . self::MAX_BODY . ' characters.');
        }

        return Filter::body($body);
    }
}
