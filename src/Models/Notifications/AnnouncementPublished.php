<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models\Notifications;

use Elabftw\Enums\Notifications;
use Elabftw\Models\Users\Users;
use Override;

/**
 * A team admin published an announcement for the team. Web-only: the
 * dashboard banner is already the primary place this is read, so there is
 * no separate email to send.
 */
final class AnnouncementPublished extends WebOnlyNotifications
{
    protected Notifications $category = Notifications::AnnouncementPublished;

    public function __construct(
        Users $targetUser,
        private Users $author,
        private int $announcementId,
        private string $title,
        private string $severity,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'announcement_id' => $this->announcementId,
            'title' => $this->title,
            'severity' => $this->severity,
            'author_fullname' => $this->author->userData['fullname'],
        );
    }
}
