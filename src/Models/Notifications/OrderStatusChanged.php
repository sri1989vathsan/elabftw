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
 * The status of an order the target user requested was changed by someone else.
 */
final class OrderStatusChanged extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_order_status_changed';

    protected Notifications $category = Notifications::OrderStatusChanged;

    public function __construct(
        Users $targetUser,
        private Users $changer,
        private int $orderId,
        private string $title,
        private string $status,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('The status of your order was updated.'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(
                    _('%s changed the status of your order "%s" to %s.'),
                    $this->changer->userData['fullname'],
                    $this->title,
                    self::statusLabel($this->status),
                ),
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
            'status' => $this->status,
            'status_label' => self::statusLabel($this->status),
            'changer_fullname' => $this->changer->userData['fullname'],
        );
    }

    // mirrors OrdersBoard.svelte's own statusLabel() -- kept here rather
    // than shared since it's only ever needed by this one notification
    private static function statusLabel(string $status): string
    {
        return match ($status) {
            'backlogged' => _('Backlogged'),
            'requested' => _('Requested'),
            'ordered' => _('Ordered'),
            'received' => _('Received'),
            'cancelled' => _('Cancelled'),
            'reference' => _('Reference'),
            default => $status,
        };
    }
}
