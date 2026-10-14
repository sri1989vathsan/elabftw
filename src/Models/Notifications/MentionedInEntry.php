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
 * Someone was @-mentioned in a comment on an experiment, template or resource.
 */
final class MentionedInEntry extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_mentioned_entry';

    protected Notifications $category = Notifications::MentionedInEntry;

    public function __construct(
        Users $targetUser,
        private Users $mentioner,
        private string $page,
        private int $entityId,
        private string $title,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('You were mentioned in a comment'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('%s mentioned you in a comment:'), $this->mentioner->userData['fullname']),
                $this->title,
                sprintf('%s/%s?mode=view&id=%d', Env::asUrl('SITE_URL'), $this->page, $this->entityId),
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
            'mentioner_fullname' => $this->mentioner->userData['fullname'],
        );
    }
}
