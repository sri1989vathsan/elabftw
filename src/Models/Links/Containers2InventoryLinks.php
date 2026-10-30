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
 * Container <-> inventory link
 */
final class Containers2InventoryLinks extends AbstractContainersLinks
{
    #[Override]
    protected function getTable(): string
    {
        return 'containers2inventory';
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
        return 'containers2inventory';
    }
}
