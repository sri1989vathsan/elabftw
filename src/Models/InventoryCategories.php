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
        $visible = array();
        foreach ($rows as $row) {
            $owner = $owners[(int) $row['id']] ?? null;
            if ($owner !== null && $owner !== $me) {
                continue;
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
