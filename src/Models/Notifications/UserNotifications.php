<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2021 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models\Notifications;

use Elabftw\Enums\Action;
use Elabftw\Enums\BinaryValue;
use Elabftw\Enums\Notifications;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\AbstractRest;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;
use PDOStatement;

use function json_decode;
use function in_array;
use function sprintf;

/**
 * Notifications for a user
 */
final class UserNotifications extends AbstractRest
{
    use SetIdTrait;

    private int $userid;

    public function __construct(private Users $users, public ?int $id = null)
    {
        parent::__construct();
        $this->userid = $this->users->userData['userid'];
        $this->setId($id);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $this->users->isSelfOrExplode();
        // the navbar bell only ever shows what's still unread -- once a
        // notification is acknowledged (clicked, or "Clear all") it drops
        // out here for good; see readHistory() for the full log
        $sql = 'SELECT id, category, body, is_ack, created_at, userid
            FROM notifications
            WHERE userid = :userid
                AND is_ack = 0
                AND ' . $this->visibilityClause() . '
            ORDER BY created_at DESC
            LIMIT 10';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $this->bindVisibilityParams($req);
        $this->Db->execute($req);

        return $this->hideDisabledStepDeadlines($req->fetchAll());
    }

    /**
     * Every notification for this user, read or not, for the "All
     * notifications" history page -- readAll() only ever shows the unread
     * ones, capped at 10, for the navbar bell.
     *
     * $search matches against the raw JSON body rather than any single
     * field -- notification categories don't share a common "title"-like
     * key (a CommentCreated's body has no readable text at all, others use
     * different key names), so a per-category field list would either miss
     * categories or need constant upkeep as new ones are added. A LIKE over
     * the JSON text can occasionally match a key name rather than its
     * value, but in practice search terms are real words, not schema keys.
     */
    public function readHistory(int $limit = 30, int $offset = 0, ?string $search = null): array
    {
        $this->users->isSelfOrExplode();
        $limitSql = sprintf(' LIMIT %d OFFSET %d', $limit, max(0, $offset));
        $searchFilter = '';
        if ($search !== null && $search !== '') {
            $searchFilter = ' AND body LIKE :search';
        }
        $sql = 'SELECT id, category, body, is_ack, created_at, userid
            FROM notifications
            WHERE userid = :userid
                AND ' . $this->visibilityClause() . $searchFilter . '
            ORDER BY created_at DESC' . $limitSql;
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $this->bindVisibilityParams($req);
        if ($searchFilter !== '') {
            $req->bindValue(':search', '%' . $search . '%', PDO::PARAM_STR);
        }
        $this->Db->execute($req);

        return $this->hideDisabledStepDeadlines($req->fetchAll());
    }

    /**
     * Step/to-do/order deadline notifications only count as "visible" once
     * they're actually due, or (deadline categories aside) always.
     */
    private function visibilityClause(): string
    {
        return '(
            (category NOT IN (
                :step_deadline,
                :todo_deadline,
                :order_reminder,
                :need_validation,
                :is_validated,
                :onboarding_email
            ))
            OR (
                category = :step_deadline
                AND DATE_ADD(NOW(), INTERVAL :notif_lead_time MINUTE) >= body->>"$.deadline"
            )
            OR (
                category = :todo_deadline
                AND NOW() >= CAST(body->>"$.remind_at" AS DATETIME)
            )
            OR (
                category = :order_reminder
                AND NOW() >= CAST(body->>"$.remind_at" AS DATETIME)
            )
        )';
    }

    private function bindVisibilityParams(PDOStatement $req): void
    {
        $req->bindValue(':step_deadline', Notifications::StepDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':todo_deadline', Notifications::TodoDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':order_reminder', Notifications::OrderReminder->value, PDO::PARAM_INT);
        $req->bindValue(':need_validation', Notifications::SelfNeedValidation->value, PDO::PARAM_INT);
        $req->bindValue(':is_validated', Notifications::SelfIsValidated->value, PDO::PARAM_INT);
        $req->bindValue(':onboarding_email', Notifications::OnboardingEmail->value, PDO::PARAM_INT);
        $req->bindValue(':notif_lead_time', StepDeadline::NOTIFLEADTIME, PDO::PARAM_INT);
    }

    private function hideDisabledStepDeadlines(array $notifs): array
    {
        foreach ($notifs as $key => &$notif) {
            $notif['body'] = json_decode($notif['body'], true, 512, JSON_THROW_ON_ERROR);
            // remove the step deadline web notif if user doesn't want it shown
            if ($this->users->userData['notif_step_deadline'] === 0
                && in_array(
                    $notif['category'],
                    array(Notifications::StepDeadline->value, Notifications::TodoDeadline->value),
                    true,
                )
            ) {
                unset($notifs[$key]);
            }
        }
        return $notifs;
    }

    #[Override]
    public function readOne(): array
    {
        $this->users->isSelfOrExplode();
        $sql = 'SELECT * FROM notifications WHERE userid = :userid AND id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->fetch($req);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->users->isSelfOrExplode();
        // BinaryValue::tryFrom(0) resolves to BinaryValue::False (a valid
        // case, not null), so relying on ?? BinaryValue::True to cover a
        // missing/omitted is_ack never actually triggers for that common
        // case -- (int) null casts to 0, which tryFrom() happily matches.
        // Check the key's presence explicitly instead: the click-to-ack
        // path (see common.ts's 'ack-notif' handler) omits is_ack entirely
        // and expects this to default to marking the notification read.
        $is_ack = array_key_exists('is_ack', $params)
            ? (BinaryValue::tryFrom((int) $params['is_ack']) ?? BinaryValue::True)
            : BinaryValue::True;
        $sql = 'UPDATE notifications SET is_ack = :is_ack WHERE id = :id AND userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':is_ack', $is_ack->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->readOne();
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/users/%d/notifications/', $this->userid);
    }

    /**
     * Delete all notifications for that user
     */
    #[Override]
    /**
     * "Clear all" from the navbar bell -- acknowledges every notification
     * rather than deleting it, so it drops out of the (unread-only) bell
     * but is still there on the "All notifications" history page.
     */
    public function destroy(): bool
    {
        $this->users->isSelfOrExplode();
        $sql = 'UPDATE notifications SET is_ack = 1 WHERE userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':userid', $this->userid, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }
}
