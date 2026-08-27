<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2021 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\AuditEvent\OnboardingEmailSent;
use Elabftw\Elabftw\Db;
use Elabftw\Enums\Notifications;
use Elabftw\Factories\NotificationsFactory;
use Elabftw\Models\Notifications\StepDeadline;
use Elabftw\Models\AuditLogs;
use Elabftw\Models\Users\Users;
use Exception;
use PDO;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Mime\Address;

use function bindtextdomain;
use function dirname;
use function putenv;
use function setlocale;
use function textdomain;
use function array_key_exists;
use function sprintf;

/**
 * Email notification system
 */
class EmailNotifications
{
    protected const BASE_SUBJECT = '[eLabFTW] ';

    protected Db $Db;

    public function __construct(protected Email $emailService)
    {
        $this->Db = Db::getConnection();
    }

    public function sendEmails(OutputInterface $output): int
    {
        $toSend = $this->getNotificationsToSend();
        $count = 0;
        foreach ($toSend as $notif) {
            try {
                $targetUser = new Users($notif['userid']);
                $this->setLang($targetUser->userData['lang']);
                $to = new Address($targetUser->userData['email'], $targetUser->userData['fullname']);
                $Factory = new NotificationsFactory($targetUser, $notif['category'], $notif['body']);
                $email = $Factory->getMailable()->getEmail();
                $cc = array_key_exists('cc', $email) ? $email['cc'] : null;
                $htmlBody = array_key_exists('htmlBody', $email) ? (string) $email['htmlBody'] : null;
                $replyTo = null;
                if (isset($email['replyTo'])) {
                    $replyTo = new Address($email['replyTo']);
                }
                $isEmailSent = $this->emailService->sendEmail(
                    $to,
                    self::BASE_SUBJECT . $email['subject'],
                    $email['body'],
                    $cc,
                    $htmlBody,
                    replyTo: $replyTo,
                );
                if ($isEmailSent) {
                    $this->setEmailSent($notif['id']);
                    if (Notifications::tryFrom($notif['category']) === Notifications::OnboardingEmail) {
                        AuditLogs::create(new OnboardingEmailSent($email['team'], $notif['userid'], $email['forAdmin']));
                    }
                }
                $count++;
            } catch (Exception $e) {
                $output->writeln(sprintf('Error sending notification: %s', $e->getMessage()));
            }
        }
        return $count;
    }

    /**
     * set the lang to the one of the target user (see issue #2700)
     * @psalm-suppress UnusedFunctionCall
     */
    protected function setLang(string $lang = 'en_GB'): void
    {
        $locale = $lang . '.utf8';
        // configure gettext
        $domain = 'messages';
        putenv("LC_ALL=$locale");
        setlocale(LC_ALL, $locale);
        bindtextdomain($domain, dirname(__DIR__) . '/langs');
        textdomain($domain);
    }

    private function getNotificationsToSend(): array
    {
        $sql = 'SELECT notifications.id, notifications.userid, notifications.category, notifications.body
            FROM notifications
            INNER JOIN users ON users.userid = notifications.userid
            WHERE notifications.send_email = 1
                AND notifications.email_sent = 0
                AND (
                    notifications.category NOT IN (:step_deadline_pref, :todo_deadline_pref)
                    OR users.notif_step_deadline_email = 1
                )
                AND (
                    notifications.category NOT IN (:step_deadline, :todo_deadline)
                    OR (
                        notifications.category = :step_deadline
                        AND DATE_ADD(NOW(), INTERVAL :notif_lead_time MINUTE) >= notifications.body->>"$.deadline"
                    )
                    OR (
                        notifications.category = :todo_deadline
                        AND NOW() >= CAST(notifications.body->>"$.remind_at" AS DATETIME)
                    )
                )';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':step_deadline_pref', Notifications::StepDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':todo_deadline_pref', Notifications::TodoDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':step_deadline', Notifications::StepDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':todo_deadline', Notifications::TodoDeadline->value, PDO::PARAM_INT);
        $req->bindValue(':notif_lead_time', StepDeadline::NOTIFLEADTIME, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    private function setEmailSent(int $id): bool
    {
        $sql = 'UPDATE notifications SET email_sent = 1, email_sent_at = NOW() WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }
}
