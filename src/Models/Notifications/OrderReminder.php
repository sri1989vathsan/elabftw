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
use PDO;

use function _;
use function sprintf;

/**
 * A reminder set on an order, due at remind_at (see Orders::updateReminderAt()).
 */
final class OrderReminder extends AbstractNotifications implements MailableInterface
{
    protected Notifications $category = Notifications::OrderReminder;

    public function __construct(
        Users $targetUser,
        private int $orderId,
        private string $title,
        // already UTC "Y-m-d H:i:s" -- see Orders::getReminderAt()
        private string $remindAt,
    ) {
        parent::__construct($targetUser);
    }

    #[Override]
    public function create(): int
    {
        $this->destroy();
        return parent::create();
    }

    #[Override]
    public function getEmail(): array
    {
        return array(
            'subject' => _('An order reminder is due.'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('Order: %s'), $this->title),
                sprintf(_('Reminder: %s'), $this->remindAt),
                Env::asUrl('SITE_URL') . '/orders.php?order=' . $this->orderId,
            ),
        );
    }

    public function destroy(): bool
    {
        $sql = 'DELETE FROM notifications
            WHERE userid = :userid
                AND category = :category
                AND body->"$.order_id" = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->targetUser->userid, PDO::PARAM_INT);
        $req->bindValue(':category', $this->category->value, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->orderId, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (bool) $req->rowCount();
    }

    #[Override]
    protected function getBody(): array
    {
        return array(
            'order_id' => $this->orderId,
            'title' => $this->title,
            'remind_at' => $this->remindAt,
        );
    }
}
