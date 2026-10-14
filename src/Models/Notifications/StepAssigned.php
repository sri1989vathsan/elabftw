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
 * A step of an experiment, template or resource was assigned to someone with an @-mention.
 */
final class StepAssigned extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_mentioned_entry';

    protected Notifications $category = Notifications::StepAssigned;

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
            'subject' => _('A step was assigned to you'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('%s assigned you a step:'), $this->mentioner->userData['fullname']),
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
