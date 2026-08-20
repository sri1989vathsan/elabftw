<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Traits\CategoryDescriptionTrait;

/**
 * Categories for experiments
 */
final class ExperimentsCategories extends AbstractStatus
{
    use CategoryDescriptionTrait;

    protected string $table = 'experiments_categories';

    protected function getDescriptionScope(): string
    {
        return CustomUiDescriptions::EXPERIMENT_CATEGORY;
    }
}
