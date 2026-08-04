<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models\Notifications;

use DateTimeImmutable;
use DateTimeZone;
use Elabftw\Elabftw\Env;
use Elabftw\Enums\Notifications;
use Elabftw\Interfaces\MailableInterface;
use Elabftw\Models\Users\Users;
use Override;
use PDO;

use function _;
use function sprintf;

/**
 * Reminder for a personal calendar to-do item.
 */
final class TodoDeadline extends AbstractNotifications implements MailableInterface
{
    protected const PREF = 'notif_step_deadline';

    protected Notifications $category = Notifications::TodoDeadline;

    public function __construct(
        Users $targetUser,
        private int $taskId,
        private string $title,
        private string $deadline,
        private int $reminderMinutes,
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
            'subject' => _('A to-do deadline is approaching.'),
            'body' => sprintf(
                "%s\n\n%s\n%s",
                sprintf(_('Task: %s'), $this->title),
                sprintf(_('Deadline: %s'), $this->deadline),
                Env::asUrl('SITE_URL') . '/dashboard.php?todo=calendar&task=' . $this->taskId,
            ),
        );
    }

    public function destroy(): bool
    {
        $sql = 'DELETE FROM notifications
            WHERE userid = :userid
                AND category = :category
                AND body->"$.task_id" = :task_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->targetUser->userid, PDO::PARAM_INT);
        $req->bindValue(':category', $this->category->value, PDO::PARAM_INT);
        $req->bindValue(':task_id', $this->taskId, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (bool) $req->rowCount();
    }

    #[Override]
    protected function getBody(): array
    {
        $deadline = new DateTimeImmutable($this->deadline, new DateTimeZone('UTC'));
        return array(
            'task_id' => $this->taskId,
            'title' => $this->title,
            'deadline' => $deadline->format('Y-m-d H:i:s'),
            'reminder_minutes' => $this->reminderMinutes,
            'remind_at' => $deadline
                ->modify(sprintf('-%d minutes', $this->reminderMinutes))
                ->format('Y-m-d H:i:s'),
        );
    }
}
