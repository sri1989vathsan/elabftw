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
        // 'content' | 'file' | 'comment' | 'received' (the shop sheet for the order's procurement arrived)
        private string $reason,
        // for 'received': how many items of the procurement are collected so far, e.g. "3/4"
        private ?string $progress = null,
        // for 'received': the procurement the collected orders belong to
        private ?string $procurementId = null,
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
        if ($this->reason === 'received') {
            return array(
                'subject' => _('Your order has been received.'),
                'body' => sprintf(
                    "%s\n\n%s\n%s",
                    self::receivedText($this->procurementId, $this->title, $this->progress),
                    sprintf(_('Order: %s'), $this->title),
                    Env::asUrl('SITE_URL') . '/orders.php?order=' . $this->orderId,
                ),
            );
        }
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
            'progress' => $this->progress,
            'procurement_id' => $this->procurementId,
            'actor_fullname' => $this->actor->userData['fullname'],
        );
    }

    /** The older wording, kept for notifications stored before the procurement number was part of them. */
    public static function receivedMessage(): string
    {
        return _('Orders from this procurement have been received: Please check if your order has been collected.');
    }

    /** "Orders from Procurement 26049739 (Order name) has been collected. Please check if your item has been delivered." */
    public static function receivedText(?string $procurementId, string $title, ?string $progress): string
    {
        $text = $procurementId === null || $procurementId === ''
            ? sprintf('%s (%s)', self::receivedMessage(), $title)
            : sprintf(_('Orders from Procurement %1$s (%2$s) has been collected. Please check if your item has been delivered.'), $procurementId, $title);
        return $text . ($progress !== null && $progress !== '' ? sprintf(' (%s)', sprintf(_('%s items collected'), $progress)) : '');
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
