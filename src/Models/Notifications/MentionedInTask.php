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
 * Someone was @-mentioned in a comment on a to-do task (sidebar or project
 * management board).
 */
final class MentionedInTask extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_mentioned_task';

    protected Notifications $category = Notifications::MentionedInTask;

    public function __construct(
        Users $targetUser,
        private Users $mentioner,
        private int $taskId,
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
                sprintf(_('%s mentioned you in a comment on a task:'), $this->mentioner->userData['fullname']),
                $this->title,
                Env::asUrl('SITE_URL') . '/projectmanagement.php',
            ),
        );
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'task_id' => $this->taskId,
            'title' => $this->title,
            'mentioner_fullname' => $this->mentioner->userData['fullname'],
        );
    }
}
