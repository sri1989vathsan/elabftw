<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Models\Announcements;
use Override;

use function array_merge;
use function _;

final class AnnouncementsHistoryController extends AbstractHtmlController
{
    #[Override]
    protected function getTemplate(): string
    {
        return 'announcements-history.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Announcements');
    }

    #[Override]
    protected function getData(): array
    {
        $Announcements = new Announcements($this->app->Users);

        return array_merge(parent::getData(), array(
            'announcements' => $Announcements->readAll(),
        ));
    }
}
