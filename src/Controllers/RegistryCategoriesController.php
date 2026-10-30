<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Override;

use function _;

/**
 * For registry-categories.php
 */
final class RegistryCategoriesController extends AbstractHtmlController
{
    #[Override]
    protected function getTemplate(): string
    {
        return 'registry-categories.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Database categories');
    }
}
