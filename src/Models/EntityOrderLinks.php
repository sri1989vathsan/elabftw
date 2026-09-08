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
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_filter;
use function array_values;
use function sprintf;

/**
 * Links an experiment/resource (and their templates) to an Order, so a
 * request in the Orders board can be traced back to the entry it's for.
 * One polymorphic table (entity_type/entity_id/order_id) rather than one
 * table per entity-type pair, the same shape as TodolistEntityLinks.
 */
final class EntityOrderLinks extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private AbstractEntity $Entity, ?int $id = null)
    {
        parent::__construct();
        // this id is the target order's id (link_id), not this table's own pk
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('%s%d/order_links/', $this->Entity->getApiPath(), $this->Entity->id ?? 0);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT link.order_id AS id, o.title, o.status
            FROM entity_order_links AS link
            INNER JOIN custom_orders AS o ON o.id = link.order_id AND o.team = :team
            WHERE link.entity_type = :entity_type AND link.entity_id = :entity_id
            ORDER BY link.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':entity_type', $this->Entity->entityType->value);
        $req->bindValue(':entity_id', $this->Entity->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    /**
     * Every experiment/resource linked to a given order -- the reverse of
     * readAll(), for a "Linked entries" section on the order's own card.
     */
    public static function readAllForOrder(int $orderId): array
    {
        $Db = Db::getConnection();
        $sql = 'SELECT link.id, link.entity_type, link.entity_id,
                CASE link.entity_type
                    WHEN "experiments" THEN (SELECT title FROM experiments WHERE id = link.entity_id)
                    WHEN "items" THEN (SELECT title FROM items WHERE id = link.entity_id)
                    WHEN "experiments_templates" THEN (SELECT title FROM experiments_templates WHERE id = link.entity_id)
                    WHEN "items_types" THEN (SELECT title FROM items_types WHERE id = link.entity_id)
                END AS title
            FROM entity_order_links AS link
            WHERE link.order_id = :order_id
            ORDER BY link.created_at ASC';
        $req = $Db->prepare($sql);
        $req->bindValue(':order_id', $orderId, PDO::PARAM_INT);
        $Db->execute($req);
        // a null title means the target was deleted -- drop it rather than
        // show a broken reference
        $rows = $req->fetchAll();
        return array_values(array_filter($rows, fn(array $row): bool => $row['title'] !== null));
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->Entity->canOrExplode(AccessType::Write);
        // the target order's id is the path segment this instance was
        // constructed with (see AbstractCompoundsLinks for the same shape),
        // not the request body -- matches the generic .linkinput handler,
        // which POSTs to {entity.type}/{entity.id}/order_links/{orderId}
        $orderId = (int) ($this->id ?? 0);
        if ($orderId <= 0) {
            throw new ImproperActionException('Invalid order id.');
        }
        $sql = 'SELECT COUNT(*) AS count FROM custom_orders WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $orderId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ((int) $this->Db->fetch($req)['count'] === 0) {
            throw new ImproperActionException('Order not found in this team.');
        }

        // use IGNORE to avoid failure on a duplicate link
        $sql = 'INSERT IGNORE INTO entity_order_links (entity_type, entity_id, order_id)
            VALUES (:entity_type, :entity_id, :order_id)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':entity_type', $this->Entity->entityType->value);
        $req->bindValue(':entity_id', $this->Entity->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $orderId, PDO::PARAM_INT);
        $this->Db->execute($req);
        $this->setId($orderId);

        return $orderId;
    }

    #[Override]
    public function destroy(): bool
    {
        $this->Entity->canOrExplode(AccessType::Write);
        $sql = 'DELETE FROM entity_order_links
            WHERE entity_type = :entity_type AND entity_id = :entity_id AND order_id = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':entity_type', $this->Entity->entityType->value);
        $req->bindValue(':entity_id', $this->Entity->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }
}
