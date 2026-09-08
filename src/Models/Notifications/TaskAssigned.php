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
 * A to-do task was assigned to someone else on the team
 */
final class TaskAssigned extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_task_assigned';

    protected Notifications $category = Notifications::TaskAssigned;

    public function __construct(
        Users $targetUser,
        private Users $assigner,
        private int $taskId,
        private string $title,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('A task was assigned to you.'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('%s assigned you a task:'), $this->assigner->userData['fullname']),
                sprintf(_('Task: %s'), $this->title),
                Env::asUrl('SITE_URL') . '/projectmanagement.php?task=' . $this->taskId,
            ),
        );
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'task_id' => $this->taskId,
            'title' => $this->title,
            'assigner_fullname' => $this->assigner->userData['fullname'],
            'assigner_userid' => $this->assigner->userid,
        );
    }
}
