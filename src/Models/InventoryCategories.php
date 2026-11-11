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
        // the personal modules of others that the user added to their view (registry-browse-modules.php): listed with the name of their owner
        $looking = $this->Db->prepare('SELECT v.category, CONCAT(u.firstname, " ", u.lastname) AS name FROM personal_module_views AS v JOIN inventory_categories AS c ON c.id = v.category
            JOIN users AS u ON u.userid = c.owner WHERE v.viewer = :me AND v.closed_at IS NULL AND v.viewed_at > NOW() - INTERVAL 30 MINUTE GROUP BY v.category, u.firstname, u.lastname');
        $looking->bindValue(':me', $me, PDO::PARAM_INT);
        $this->Db->execute($looking);
        $lookedAt = array();
        foreach ($looking->fetchAll(PDO::FETCH_ASSOC) as $module) {
            $lookedAt[(int) $module['category']] = (string) $module['name'];
        }
        // in this order: the modules of the lab, then the personal modules of the user, then the ones of others they added to their view
        $lab = array();
        $mine = array();
        $others = array();
        foreach ($rows as $row) {
            $owner = $owners[(int) $row['id']] ?? null;
            if ($owner !== null && $owner !== $me && !isset($lookedAt[(int) $row['id']])) {
                continue;
            }
            $row['is_personal'] = $owner === null ? 0 : 1;
            if ($owner === null) {
                $lab[] = $row;
            } elseif ($owner === $me) {
                $mine[] = $row;
            } else {
                $row['sort_title'] = $row['title'];
                $row['title'] = $row['title'] . ' (' . $lookedAt[(int) $row['id']] . ')';
                $row['looked_category'] = (int) $row['id'];
                $others[] = $row;
            }
        }
        // the personal modules are in their natural order (module 2 before module 10); the ones of others by their owner
        usort($mine, static fn(array $a, array $b): int => strnatcasecmp((string) $a['title'], (string) $b['title']));
        usort($others, fn(array $a, array $b): int => strnatcasecmp($lookedAt[(int) $a['id']] . ' ' . $a['sort_title'], $lookedAt[(int) $b['id']] . ' ' . $b['sort_title']));
        return array_merge($lab, $mine, $others);
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
