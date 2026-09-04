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

use function array_filter;
use function array_values;
use function filter_var;
use function in_array;
use function mb_strlen;
use function sprintf;
use function trim;

use const FILTER_VALIDATE_URL;

/**
 * Links a to-do task to an experiment, template, resource, resource
 * template, or a plain web URL so related work stays cross-referenced.
 * Anyone on the task's team can add or remove a link, same as commenting on
 * the task; a linked entity must belong to that same team.
 */
final class TodolistEntityLinks extends AbstractRest
{
    use SetIdTrait;

    /** @var list<string> */
    private const array ALLOWED_ENTITY_TYPES = array('experiments', 'items', 'experiments_templates', 'items_types');

    private const string WEBLINK_TYPE = 'weblink';

    public function __construct(private Users $Users, private Todolist $Task, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/todolist/%d/entity_links/', $this->Task->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = "SELECT link.id, link.entity_type, link.entity_id, link.url,
                CASE link.entity_type
                    WHEN 'weblink' THEN link.label
                    WHEN 'experiments' THEN (SELECT title FROM experiments WHERE id = link.entity_id AND team = :team)
                    WHEN 'items' THEN (SELECT title FROM items WHERE id = link.entity_id AND team = :team)
                    WHEN 'experiments_templates' THEN (SELECT title FROM experiments_templates WHERE id = link.entity_id AND team = :team)
                    WHEN 'items_types' THEN (SELECT title FROM items_types WHERE id = link.entity_id AND team = :team)
                END AS title
            FROM todolist_entity_links AS link
            INNER JOIN todolist AS task ON task.id = link.task_id AND task.team = :team
            WHERE link.task_id = :task_id
            ORDER BY link.created_at ASC";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        // a null title means the target was deleted, or somehow belongs to
        // another team -- drop it rather than show a broken reference
        return array_values(array_filter($req->fetchAll(), fn(array $row): bool => $row['title'] !== null));
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $link) {
            if ((int) $link['id'] === $this->id) {
                return $link;
            }
        }
        throw new ResourceNotFoundException();
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $entityType = (string) ($reqBody['entity_type'] ?? '');
        if ($entityType === self::WEBLINK_TYPE) {
            return $this->addWeblink($reqBody);
        }
        return $this->addEntityLink($entityType, (int) ($reqBody['entity_id'] ?? 0));
    }

    private function addEntityLink(string $entityType, int $entityId): int
    {
        if (!in_array($entityType, self::ALLOWED_ENTITY_TYPES, true) || $entityId <= 0) {
            throw new ImproperActionException('Invalid entity type or id.');
        }
        // entity_type is restricted to the whitelist above before it ever
        // reaches this query, so it's safe to use as a literal table name
        $sql = sprintf('SELECT COUNT(*) AS count FROM %s WHERE id = :id AND team = :team', $entityType);
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $entityId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException('Item not found in this team.');
        }

        $sql = 'INSERT INTO todolist_entity_links (task_id, entity_type, entity_id)
            SELECT task.id, :entity_type, :entity_id
            FROM todolist AS task
            WHERE task.id = :task_id AND task.team = :team
            ON DUPLICATE KEY UPDATE todolist_entity_links.id = todolist_entity_links.id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ($req->rowCount() === 0) {
            throw new ResourceNotFoundException();
        }

        return (int) $this->Db->lastInsertId();
    }

    private function addWeblink(array $reqBody): int
    {
        $url = (string) ($reqBody['url'] ?? '');
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw new ImproperActionException('Enter a valid web address.');
        }
        $label = trim((string) ($reqBody['label'] ?? '')) ?: $url;
        if (mb_strlen($label) > 500) {
            throw new ImproperActionException('Link label must be shorter than 500 characters.');
        }
        if (mb_strlen($url) > 2000) {
            throw new ImproperActionException('Web address must be shorter than 2000 characters.');
        }

        $sql = 'INSERT INTO todolist_entity_links (task_id, entity_type, url, label)
            SELECT task.id, :entity_type, :url, :label
            FROM todolist AS task
            WHERE task.id = :task_id AND task.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':entity_type', self::WEBLINK_TYPE);
        $req->bindValue(':url', $url);
        $req->bindValue(':label', $label);
        $this->Db->execute($req);
        if ($req->rowCount() === 0) {
            throw new ResourceNotFoundException();
        }

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE link FROM todolist_entity_links AS link
            INNER JOIN todolist AS task ON task.id = link.task_id AND task.team = :team
            WHERE link.id = :id AND link.task_id = :task_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->Task->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }
}
