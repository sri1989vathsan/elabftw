<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use PDO;
use Elabftw\Traits\CategoryDescriptionTrait;
use Override;

/**
 * Categories of the inventory
 */
final class InventoryCategories extends AbstractStatus
{
    use CategoryDescriptionTrait;

    protected string $table = 'inventory_categories';

    protected function getDescriptionScope(): string
    {
        return CustomUiDescriptions::RESOURCE_CATEGORY;
    }

    #[Override]
    protected function getUsersCanwriteName(): string
    {
        return 'resources_categories';
    }

    /**
     * The modules of the lab and the personal modules of the user: the personal modules of other people are not listed. A row has
     * is_personal (1 for a personal module of the user).
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $rows = parent::readAll($queryParams);
        $req = $this->Db->prepare('SELECT id, owner FROM inventory_categories WHERE owner IS NOT NULL');
        $this->Db->execute($req);
        $owners = array();
        foreach ($req->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $owners[(int) $row['id']] = (int) $row['owner'];
        }
        $me = (int) $this->Teams->Users->userData['userid'];
        // the people whose personal modules the user is looking at (registry-browse-modules.php): their modules are listed with their name
        $looking = $this->Db->prepare('SELECT v.owner, CONCAT(u.firstname, " ", u.lastname) AS name FROM personal_module_views AS v JOIN users AS u ON u.userid = v.owner
            WHERE v.viewer = :me AND v.closed_at IS NULL AND v.viewed_at > NOW() - INTERVAL 30 MINUTE GROUP BY v.owner, u.firstname, u.lastname');
        $looking->bindValue(':me', $me, PDO::PARAM_INT);
        $this->Db->execute($looking);
        $lookedAt = array();
        foreach ($looking->fetchAll(PDO::FETCH_ASSOC) as $person) {
            $lookedAt[(int) $person['owner']] = (string) $person['name'];
        }
        $visible = array();
        foreach ($rows as $row) {
            $owner = $owners[(int) $row['id']] ?? null;
            if ($owner !== null && $owner !== $me && !isset($lookedAt[$owner])) {
                continue;
            }
            if ($owner !== null && $owner !== $me) {
                $row['title'] = $row['title'] . ' (' . $lookedAt[$owner] . ')';
                $row['looked_owner'] = $owner;
            }
            $row['is_personal'] = $owner === null ? 0 : 1;
            $visible[] = $row;
        }
        return $visible;
    }

    // categories are admin-only to write: everyone can view them (see
    // web/resources-categories.php), but unlike statuses, there is no
    // per-team "let regular users manage this" toggle for categories
    #[Override]
    protected function canWriteOrExplode(): void
    {
        if (!$this->Teams->Users->isAdmin) {
            throw new IllegalActionException();
        }
    }
}
