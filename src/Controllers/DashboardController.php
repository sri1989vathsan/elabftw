<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use DateTimeImmutable;
use Elabftw\Elabftw\PermissionsHelper;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\Notifications;
use Elabftw\Enums\Orderby;
use Elabftw\Models\Announcements;
use Elabftw\Models\DashboardStats;
use Elabftw\Models\Experiments;
use Elabftw\Models\ExperimentsStatus;
use Elabftw\Models\FavTags;
use Elabftw\Models\Items;
use Elabftw\Models\ItemsStatus;
use Elabftw\Models\ItemsTypes;
use Elabftw\Models\Notifications\UserNotifications;
use Elabftw\Models\Scheduler;
use Elabftw\Models\Templates;
use Elabftw\Models\UserRequestActions;
use Elabftw\Params\DisplayParams;
use Override;
use Symfony\Component\HttpFoundation\InputBag;

use function array_filter;
use function array_merge;
use function _;

/**
 * For dashboard.php
 */
final class DashboardController extends AbstractHtmlController
{
    private const int SHOWN_NUMBER = 6;

    // The Scheduled bookings card is switched off for now. PHP and Twig both read this one value (passed to the template as
    // showScheduledBookings), and nothing of the scheduler is loaded while it is off. Set it to true to show the card again.
    private const bool SHOW_SCHEDULED_BOOKINGS = false;

    #[Override]
    protected function getTemplate(): string
    {
        return 'dashboard.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Dashboard');
    }

    #[Override]
    protected function getData(): array
    {
        $DisplayParamsExp = new DisplayParams(
            $this->app->Users,
            EntityType::Experiments,
            orderby: Orderby::Lastchange,
            limit: self::SHOWN_NUMBER,
        );
        $Experiments = new Experiments($this->app->Users);
        $Items = new Items($this->app->Users);
        $ItemsTypes = new ItemsTypes($this->app->Users);
        $Templates = new Templates($this->app->Users);
        // for items we need to create a new DisplayParams object, otherwise the scope setting will also apply here
        $DisplayParamsItems = new DisplayParams(
            $this->app->Users,
            EntityType::Items,
            orderby: Orderby::Lastchange,
            limit: self::SHOWN_NUMBER,
        );
        $PermissionsHelper = new PermissionsHelper();
        $ExperimentsStatus = new ExperimentsStatus($this->app->Teams);
        $ItemsStatus = new ItemsStatus($this->app->Teams);
        $UserRequestActions = new UserRequestActions($this->app->Users);
        $Announcements = new Announcements($this->app->Users);
        $bookingsArr = array();
        if (self::SHOW_SCHEDULED_BOOKINGS) {
            $now = new DateTimeImmutable();
            $Scheduler = new Scheduler($Items, start: $now->format(DateTimeImmutable::ATOM));
            $bookingsArr = $Scheduler->readAll();
        }
        $DashboardStats = new DashboardStats($this->app->Users);

        $DisplayParamsTemplates = new DisplayParams($this->app->Users, EntityType::Templates);
        $DisplayParamsItemsTypes = new DisplayParams($this->app->Users, EntityType::ItemsTypes);

        $FavTags = new FavTags($this->app->Users);
        $favTagsArr = $FavTags->readAll();

        // "New" on the dashboard feed is the same signal as the bell's own
        // unread state, not a separate localStorage-tracked flag -- an
        // announcement.id shows up here only while its AnnouncementPublished
        // notification for this user is still unacknowledged, and the JS
        // (see refreshAnnouncementWidgets() in common.ts) acks it the same
        // way the bell dropdown does once the card has actually been seen.
        $UserNotifications = new UserNotifications($this->app->Users);
        $unackedAnnouncementNotifs = array_filter(
            $UserNotifications->readByCategory(Notifications::AnnouncementPublished, 50),
            static fn(array $notif): bool => !$notif['is_ack'],
        );
        // announcement_id is nested inside 'body', out of reach for
        // array_column()'s own index-by-column argument, so map it by hand;
        // the resulting keys (announcement.id) are also what Twig checks to
        // know whether to show the "New" badge at all.
        $notifIdByAnnouncementId = array();
        foreach ($unackedAnnouncementNotifs as $notif) {
            $notifIdByAnnouncementId[(int) $notif['body']['announcement_id']] = (int) $notif['id'];
        }

        return array_merge(
            parent::getData(),
            array(
                'announcementsArr' => $Announcements->readActive(),
                'notifIdByAnnouncementId' => $notifIdByAnnouncementId,
                'showScheduledBookings' => self::SHOW_SCHEDULED_BOOKINGS,
                'bookingsArr' => $bookingsArr,
                'statsModifiedThisWeek' => $DashboardStats->modifiedThisWeek(),
                'statsOpenSteps' => $DashboardStats->openSteps(),
                'statsOpenTasks' => $DashboardStats->openTasks(),
                'countExpStatus' => $DashboardStats->countsBy('experiments', 'status'),
                'countExpCategory' => $DashboardStats->countsBy('experiments', 'category'),
                'countResStatus' => $DashboardStats->countsBy('items', 'status'),
                'countResCategory' => $DashboardStats->countsBy('items', 'category'),
                'statsResourcesModifiedThisWeek' => $DashboardStats->resourcesModifiedThisWeek(),
                'itemsStatusArr' => $ItemsStatus->readAll(),
                'experimentsArr' => $Experiments->readShow($DisplayParamsExp),
                'experimentsStatusArr' => $ExperimentsStatus->readAll($ExperimentsStatus->getQueryParams(new InputBag(array('limit' => 9999)))),
                'favTagsArr' => $favTagsArr,
                'itemsArr' => $Items->readShow($DisplayParamsItems),
                'itemsTemplatesArr' => $ItemsTypes->readAllSimple($DisplayParamsItemsTypes),
                'requestActionsArr' => $UserRequestActions->readAllFull(),
                'templatesArr' => $Templates->readAllSimple($DisplayParamsTemplates),
                'usersArr' => $this->app->Users->readAllActiveFromTeam(),
                'visibilityArr' => $PermissionsHelper->getAssociativeArray(),
            ),
        );
    }
}
