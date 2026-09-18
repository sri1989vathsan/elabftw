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
 * Someone was @-mentioned in a comment on a feedback board item.
 */
final class MentionedInFeedback extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_mentioned_feedback';

    protected Notifications $category = Notifications::MentionedInFeedback;

    public function __construct(
        Users $targetUser,
        private Users $mentioner,
        private int $itemId,
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
                sprintf(_('%s mentioned you in a comment on a feedback item:'), $this->mentioner->userData['fullname']),
                $this->title,
                Env::asUrl('SITE_URL') . '/feedback.php',
            ),
        );
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'item_id' => $this->itemId,
            'title' => $this->title,
            'mentioner_fullname' => $this->mentioner->userData['fullname'],
        );
    }
}
