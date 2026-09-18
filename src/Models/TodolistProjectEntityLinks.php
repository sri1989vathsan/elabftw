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
use function array_key_exists;
use function array_values;
use function filter_var;
use function in_array;
use function mb_strlen;
use function sprintf;
use function trim;

use const FILTER_VALIDATE_URL;

/**
 * Links a to-do project (or subproject) to an experiment, template,
 * resource, resource template, or a plain web URL -- independent of any
 * single task, so material relevant to the whole project doesn't have to be
 * attached to one arbitrary task instead. Mirrors TodolistEntityLinks.
 */
final class TodolistProjectEntityLinks extends AbstractRest
{
    use SetIdTrait;

    /** @var list<string> */
    private const array ALLOWED_ENTITY_TYPES = array('experiments', 'items', 'experiments_templates', 'items_types');

    private const string WEBLINK_TYPE = 'weblink';

    public function __construct(private Users $Users, private TodolistProjects $Project, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/todolist_projects/%d/entity_links/', $this->Project->id ?? 0);
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
            FROM todolist_project_entity_links AS link
            INNER JOIN todolist_projects AS project ON project.id = link.project_id AND project.team = :team
            WHERE link.project_id = :project_id
            ORDER BY link.created_at ASC";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':project_id', $this->Project->id, PDO::PARAM_INT);
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

        $sql = 'INSERT INTO todolist_project_entity_links (project_id, entity_type, entity_id)
            SELECT project.id, :entity_type, :entity_id
            FROM todolist_projects AS project
            WHERE project.id = :project_id AND project.team = :team
            ON DUPLICATE KEY UPDATE todolist_project_entity_links.id = todolist_project_entity_links.id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':project_id', $this->Project->id, PDO::PARAM_INT);
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

        $sql = 'INSERT INTO todolist_project_entity_links (project_id, entity_type, url, label)
            SELECT project.id, :entity_type, :url, :label
            FROM todolist_projects AS project
            WHERE project.id = :project_id AND project.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':project_id', $this->Project->id, PDO::PARAM_INT);
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
    public function patch(Action $action, array $params): array
    {
        $link = $this->readOne();
        if ($link['entity_type'] !== self::WEBLINK_TYPE) {
            throw new ImproperActionException('Only a web link can be edited; remove and re-add a linked item instead.');
        }
        $sets = array();
        $bind = array(':id' => array($this->id, PDO::PARAM_INT), ':project_id' => array($this->Project->id, PDO::PARAM_INT));
        if (array_key_exists('url', $params)) {
            $url = (string) $params['url'];
            if (filter_var($url, FILTER_VALIDATE_URL) === false) {
                throw new ImproperActionException('Enter a valid web address.');
            }
            if (mb_strlen($url) > 2000) {
                throw new ImproperActionException('Web address must be shorter than 2000 characters.');
            }
            $sets[] = 'url = :url';
            $bind[':url'] = array($url, PDO::PARAM_STR);
        }
        if (array_key_exists('label', $params)) {
            $label = trim((string) $params['label']) ?: (string) ($params['url'] ?? $link['url']);
            if (mb_strlen($label) > 500) {
                throw new ImproperActionException('Link label must be shorter than 500 characters.');
            }
            $sets[] = 'label = :label';
            $bind[':label'] = array($label, PDO::PARAM_STR);
        }
        if ($sets === array()) {
            return $this->readOne();
        }
        $sql = 'UPDATE todolist_project_entity_links SET ' . implode(', ', $sets) . ' WHERE id = :id AND project_id = :project_id';
        $req = $this->Db->prepare($sql);
        foreach ($bind as $param => $valueAndType) {
            $req->bindValue($param, $valueAndType[0], $valueAndType[1]);
        }
        $this->Db->execute($req);

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE link FROM todolist_project_entity_links AS link
            INNER JOIN todolist_projects AS project ON project.id = link.project_id AND project.team = :team
            WHERE link.id = :id AND link.project_id = :project_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':project_id', $this->Project->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }
}
