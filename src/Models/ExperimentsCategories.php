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

use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Traits\CategoryDescriptionTrait;
use Override;

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

    // categories are admin-only to write: everyone can view them (see
    // web/experiments-categories.php), but unlike statuses, there is no
    // per-team "let regular users manage this" toggle for categories
    #[Override]
    protected function canWriteOrExplode(): void
    {
        if (!$this->Teams->Users->isAdmin) {
            throw new IllegalActionException();
        }
    }
}
