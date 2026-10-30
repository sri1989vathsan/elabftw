<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2024 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models\Links;

use Elabftw\Enums\EntityType;
use Override;

/**
 * Inventory entries linked from an inventory entry
 */
final class Inventory2InventoryLinks extends AbstractItemsLinks
{
    #[Override]
    protected function getTable(): string
    {
        return 'inventory2inventory';
    }

    #[Override]
    protected function getOtherImportTypeTable(): string
    {
        return 'inventory2experiments';
    }

    #[Override]
    protected function getTargetType(): EntityType
    {
        return EntityType::Inventory;
    }

    #[Override]
    protected function getCatTable(): string
    {
        return 'inventory_categories';
    }

    #[Override]
    protected function getStatusTable(): string
    {
        return 'inventory_status';
    }

    #[Override]
    protected function getImportTargetTable(): string
    {
        return 'inventory2inventory';
    }

    #[Override]
    protected function getOtherImportTargetTable(): string
    {
        return 'inventory2experiments';
    }

    #[Override]
    protected function getRelatedTable(): string
    {
        return 'inventory2inventory';
    }
}
