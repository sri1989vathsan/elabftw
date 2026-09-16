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
 * Someone else made a change to an order the target user requested --
 * edited its content, attached a file, or left a comment (status changes
 * have their own separate OrderStatusChanged notification).
 */
final class OrderChanged extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_order_changed';

    protected Notifications $category = Notifications::OrderChanged;

    public function __construct(
        Users $targetUser,
        private Users $actor,
        private int $orderId,
        private string $title,
        // 'content' | 'file' | 'comment'
        private string $reason,
    ) {
        parent::__construct($targetUser);
    }

    // this category's value is >= 20, which AbstractNotifications::getPref()
    // otherwise treats as "no per-user preference, always send" -- override
    // it here so this one still respects notif_order_changed(_email)
    #[Override]
    protected function getPref(): array
    {
        $userData = $this->targetUser->userData;
        return array($userData[self::PREF], $userData[self::PREF . '_email']);
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('Your order was updated.'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf('%s %s.', $this->actor->userData['fullname'], self::summary($this->reason)),
                sprintf(_('Order: %s'), $this->title),
                Env::asUrl('SITE_URL') . '/orders.php?order=' . $this->orderId,
            ),
        );
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'order_id' => $this->orderId,
            'title' => $this->title,
            'reason' => $this->reason,
            'actor_fullname' => $this->actor->userData['fullname'],
        );
    }

    // mirrors Transform.php's own copy of this -- kept here rather than
    // shared since it's only ever needed by this one notification's email
    public static function summary(string $reason): string
    {
        return match ($reason) {
            'file' => _('attached a file to your order'),
            'comment' => _('commented on your order'),
            default => _('made changes to your order'),
        };
    }
}
