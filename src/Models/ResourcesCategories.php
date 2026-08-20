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

use Elabftw\Traits\CategoryDescriptionTrait;
use Override;

/**
 * Categories for items (aka resources)
 */
final class ResourcesCategories extends AbstractStatus
{
    use CategoryDescriptionTrait;

    protected string $table = 'items_categories';

    protected function getDescriptionScope(): string
    {
        return CustomUiDescriptions::RESOURCE_CATEGORY;
    }

    #[Override]
    protected function getUsersCanwriteName(): string
    {
        return 'resources_categories';
    }
}
