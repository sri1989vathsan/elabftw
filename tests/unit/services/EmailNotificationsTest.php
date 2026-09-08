<?php

declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2021 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Services;

use DateTime;
use Elabftw\Elabftw\Db;
use Elabftw\Enums\Action;
use Elabftw\Enums\EntityType;
use Elabftw\Models\Notifications\CommentCreated;
use Elabftw\Models\Notifications\EventDeleted;
use Elabftw\Models\Notifications\MathjaxFailed;
use Elabftw\Models\Notifications\PdfAppendmentFailed;
use Elabftw\Models\Notifications\SelfIsValidated;
use Elabftw\Models\Notifications\SelfNeedValidation;
use Elabftw\Models\Notifications\StepDeadline;
use Elabftw\Models\Notifications\TodoDeadline;
use Elabftw\Models\Notifications\UserCreated;
use Elabftw\Models\Notifications\UserNeedValidation;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\TestsUtilsTrait;
use Symfony\Component\Console\Output\ConsoleOutput;
use PDO;

class EmailNotificationsTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    public function testSendEmails(): void
    {
        // create a notification to fake send so there is something to process
        $targetUser = new Users(1);
        $Notifications = new CommentCreated($targetUser, EntityType::Experiments->toPage(), 1, 2);
        $Notifications->create();
        $Notifications = new UserCreated($targetUser, 3, 'Some team name');
        $Notifications->create();
        $Notifications = new UserNeedValidation($targetUser, 3, 'Some team name');
        $Notifications->create();
        $Notifications = new SelfNeedValidation($targetUser);
        $Notifications->create();
        $Notifications = new SelfIsValidated($targetUser);
        $Notifications->create();
        $Notifications = new MathjaxFailed($targetUser, 1, EntityType::Experiments->toPage());
        $Notifications->create();
        $Notifications = new PdfAppendmentFailed($targetUser, 1, EntityType::Experiments->toPage(), 'file1.pdf, file2.pdf');
        $Notifications->create();

        $d = new DateTime();

        $Notifications = new EventDeleted(
            $targetUser,
            array('item' => 12, 'start' => $d->format('Y-m-d H:i:s'), 'end' => $d->format('Y-m-d H:i:s')),
            'Daniel Balavoine',
        );
        $targetCount = $Notifications->postAction(Action::Create, array(
            'msg' => 'Had to cancel booking because my cells died :(',
            'target' => 'team',
            'targetid' => 1,
        ));
        // TODO fix so it can vary in tests
        //$this->assertEquals(22, $targetCount);
        $this->assertIsInt($targetCount);
        $this->assertIsArray($Notifications->readOne());
        $this->assertIsArray($Notifications->patch(Action::Update, array()));
        $this->assertIsString($Notifications->getApiPath());
        $this->assertFalse($Notifications->destroy());

        // create a deadline close to now
        $d->modify('+ 5 min');
        $Notifications = new StepDeadline($targetUser, 1, 1, EntityType::Experiments->toPage(), $d->format('Y-m-d H:i:s'));
        $Notifications->create();
        // create it several times to toggle it and go in all code paths
        $Notifications->create();
        $Notifications->create();

        $this->stubEmail();
    }

    public function testDoNotSendEmailsToArchivedUserInAllTeams(): void
    {
        $targetUser = $this->getRandomUserInTeam(1);

        $Notifications = new CommentCreated($targetUser, EntityType::Experiments->toPage(), 1, 2);
        $notif = $Notifications->create();

        $this->stubEmail();

        // Check if email is sent for non archived users
        $Db = Db::getConnection();
        $sql = 'SELECT email_sent, email_sent_at FROM notifications WHERE id = :id';
        $req = $Db->prepare($sql);
        $req->bindParam(':id', $notif, PDO::PARAM_INT);
        $Db->execute($req);
        $row = $req->fetch();
        $this->assertSame(1, $row['email_sent']);
        $this->assertNotNull($row['email_sent_at']);

        // archive user
        $this->updateArchiveStatus($targetUser->userid, 1);
        $NotificationsFails = new CommentCreated($targetUser, EntityType::Experiments->toPage(), 1, 2);
        $notifFails = $NotificationsFails->create();
        $this->assertSame(0, $notifFails);

        // Restore user archive status
        $this->updateArchiveStatus($targetUser->userid, 0);
    }

    public function testDeadlineEmailsHonorCurrentPreferenceAtSendTime(): void
    {
        $Db = Db::getConnection();
        $targetUser = $this->getRandomUserInTeam(1);
        $originalPreference = (int) $targetUser->userData['notif_step_deadline_email'];
        $preferenceReq = $Db->prepare(
            'UPDATE users SET notif_step_deadline_email = :preference WHERE userid = :userid',
        );
        $preferenceReq->bindValue(':preference', 1, PDO::PARAM_INT);
        $preferenceReq->bindValue(':userid', $targetUser->userid, PDO::PARAM_INT);
        $Db->execute($preferenceReq);
        $targetUser = new Users($targetUser->userid);
        $deadline = new DateTime('+5 minutes');
        $stepNotification = new StepDeadline(
            $targetUser,
            900000 + $targetUser->userid,
            1,
            EntityType::Experiments->toPage(),
            $deadline->format('Y-m-d H:i:s'),
        );
        $stepNotificationId = $stepNotification->create();
        $todoNotification = new TodoDeadline(
            $targetUser,
            900000 + $targetUser->userid,
            'Preference check',
            $deadline->format('Y-m-d H:i:s'),
            60,
        );
        $todoNotificationId = $todoNotification->create();
        $this->assertGreaterThan(0, $stepNotificationId);
        $this->assertGreaterThan(0, $todoNotificationId);

        try {
            // Deliberately bypass Users::rawUpdate so stale queued rows retain
            // send_email=1 and exercise the dispatch-time safety check.
            $preferenceReq->bindValue(':preference', 0, PDO::PARAM_INT);
            $Db->execute($preferenceReq);
            $this->stubEmail();

            $req = $Db->prepare('SELECT email_sent FROM notifications WHERE id IN (:step, :todo) ORDER BY id');
            $req->bindValue(':step', $stepNotificationId, PDO::PARAM_INT);
            $req->bindValue(':todo', $todoNotificationId, PDO::PARAM_INT);
            $Db->execute($req);
            $this->assertSame(array(0, 0), $req->fetchAll(PDO::FETCH_COLUMN));
        } finally {
            $req = $Db->prepare('DELETE FROM notifications WHERE id IN (:step, :todo)');
            $req->bindValue(':step', $stepNotificationId, PDO::PARAM_INT);
            $req->bindValue(':todo', $todoNotificationId, PDO::PARAM_INT);
            $Db->execute($req);
            $preferenceReq->bindValue(':preference', $originalPreference, PDO::PARAM_INT);
            $Db->execute($preferenceReq);
        }
    }

    private function stubEmail(): void
    {
        $stub = $this->createStub(Email::class);
        $stub->method('sendEmail')->willReturn(true);
        $EmailNotifications = new EmailNotifications($stub);
        // valid ones
        $EmailNotifications->sendEmails(new ConsoleOutput());
    }
}
