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
 * A step of an experiment, template or resource was completed by someone it
 * was assigned to; sent to whoever assigned it.
 */
final class StepFinished extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_step_finished';

    protected Notifications $category = Notifications::StepFinished;

    public function __construct(
        Users $targetUser,
        private Users $finisher,
        private string $page,
        private int $entityId,
        private string $title,
        private string $step,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('A step you assigned was completed'),
            'body' => sprintf(
                "%s\n\n%s\n%s\n%s",
                sprintf(_('%s completed a step you assigned:'), $this->finisher->userData['fullname']),
                $this->step,
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
            'step' => $this->step,
            'finisher_fullname' => $this->finisher->userData['fullname'],
        );
    }
}
