<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models\Notifications;

use Elabftw\Elabftw\Env;
use Elabftw\Enums\Notifications;
use Elabftw\Interfaces\MailableInterface;
use Elabftw\Models\Users\Users;
use Override;

use function _;
use function sprintf;

/**
 * Someone was newly granted read access to an experiment/resource, either
 * directly or through a team/team-group they belong to.
 */
final class AccessGranted extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_access_granted';

    protected Notifications $category = Notifications::AccessGranted;

    public function __construct(
        Users $targetUser,
        private Users $granter,
        private string $page,
        private int $entityId,
        private string $title,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function getEmail(): array
    {
        $url = sprintf('%s/%s?mode=view&id=%d', Env::asUrl('SITE_URL'), $this->page, $this->entityId);
        return array(
            'subject' => _('You were given access to an entry'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('%s gave you access to:'), $this->granter->userData['fullname']),
                $this->title,
                $url,
            ),
        );
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'page' => $this->page,
            'entity_id' => $this->entityId,
            'title' => $this->title,
            'granter_fullname' => $this->granter->userData['fullname'],
        );
    }
}
