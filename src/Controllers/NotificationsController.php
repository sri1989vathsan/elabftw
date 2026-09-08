<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Models\Notifications\UserNotifications;
use Override;

use function array_merge;
use function array_pop;
use function count;
use function max;
use function _;

final class NotificationsController extends AbstractHtmlController
{
    private const int PAGE_SIZE = 30;

    #[Override]
    protected function getTemplate(): string
    {
        return 'notifications.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Notifications');
    }

    #[Override]
    protected function getData(): array
    {
        $offset = max(0, $this->app->Request->query->getInt('offset'));
        $UserNotifications = new UserNotifications($this->app->Users);
        // ask for one extra row so the template can tell whether there's a
        // next page without a separate COUNT query
        $notifs = $UserNotifications->readHistory(self::PAGE_SIZE + 1, $offset);
        $hasNextPage = count($notifs) > self::PAGE_SIZE;
        if ($hasNextPage) {
            array_pop($notifs);
        }

        return array_merge(parent::getData(), array(
            'notifs' => $notifs,
            'notifOffset' => $offset,
            'notifPageSize' => self::PAGE_SIZE,
            'notifHasNextPage' => $hasNextPage,
        ));
    }
}
