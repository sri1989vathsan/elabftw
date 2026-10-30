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

use Override;

/**
 * Experiments linked from an inventory entry
 */
final class Inventory2ExperimentsLinks extends AbstractExperimentsLinks
{
    #[Override]
    protected function getTable(): string
    {
        return 'inventory2experiments';
    }

    #[Override]
    protected function getOtherImportTypeTable(): string
    {
        return 'inventory2inventory';
    }

    #[Override]
    protected function getRelatedTable(): string
    {
        return 'experiments2inventory';
    }
}
