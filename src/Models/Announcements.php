<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use DateTimeImmutable;
use DateTimeZone;
use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Notifications\AnnouncementPublished;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Exception;
use Override;
use PDO;

use function array_key_exists;
use function in_array;
use function mb_strlen;
use function trim;

/**
 * Team-scoped announcements. A team admin publishes one (title/body/
 * severity, optional expiry) and every team member gets a notification
 * plus a dismissible dashboard banner until it expires.
 */
final class Announcements extends AbstractRest
{
    use SetIdTrait;

    private const array SEVERITIES = array('info', 'warning');

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/announcements/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->canWriteOrExplode();
        $severity = $this->getSeverity($reqBody['severity'] ?? null);
        $title = $this->getTitle($reqBody['title'] ?? '');
        $body = $this->getBody($reqBody['body'] ?? null);
        $expiresAt = $this->getExpiresAt($reqBody['expires_at'] ?? null);

        $sql = 'INSERT INTO custom_announcements (team, userid, title, body, severity, expires_at)
            VALUES (:team, :userid, :title, :body, :severity, :expires_at)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':severity', $severity);
        $req->bindValue(':expires_at', $expiresAt, $expiresAt === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $this->Db->execute($req);
        $id = (int) $this->Db->lastInsertId();
        $this->setId($id);

        $this->notifyTeam($id, $title, $body, $severity);

        return $id;
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = self::selectSql() . '
            WHERE announcement.team = :team
            ORDER BY announcement.pinned DESC, announcement.created_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    /**
     * The active (not yet expired) announcements for this team, most
     * recent first -- what the dashboard banner shows.
     */
    public function readActive(): array
    {
        $sql = self::selectSql() . '
            WHERE announcement.team = :team
                AND (announcement.expires_at IS NULL OR announcement.expires_at > UTC_TIMESTAMP())
            ORDER BY announcement.pinned DESC, announcement.created_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        $sql = self::selectSql() . ' WHERE announcement.id = :id AND announcement.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $announcement = $this->Db->fetch($req);

        return $this->hydrate($announcement);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->canWriteOrExplode();
        $announcement = $this->readOne();

        if ($action === Action::Expire) {
            $this->updateExpiresAt((new DateTimeImmutable())->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'));
            return $this->readOne();
        }

        if ($action === Action::Pin) {
            $this->togglePinned(!$announcement['pinned']);
            return $this->readOne();
        }

        $title = array_key_exists('title', $params) ? $this->getTitle($params['title']) : $announcement['title'];
        $body = array_key_exists('body', $params) ? $this->getBody($params['body']) : $announcement['body'];
        $severity = array_key_exists('severity', $params) ? $this->getSeverity($params['severity']) : $announcement['severity'];
        $expiresAt = array_key_exists('expires_at', $params) ? $this->getExpiresAt($params['expires_at']) : $announcement['expires_at'];

        $sql = 'UPDATE custom_announcements SET title = :title, body = :body, severity = :severity, expires_at = :expires_at
            WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':severity', $severity);
        $req->bindValue(':expires_at', $expiresAt, $expiresAt === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->canWriteOrExplode();
        // make sure it belongs to our team before deleting it
        $this->readOne();
        $sql = 'DELETE FROM custom_announcements WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /** Only a team admin can create, edit, expire or delete an announcement. */
    private function canWriteOrExplode(): void
    {
        if (!$this->Users->isAdmin) {
            throw new ImproperActionException('Only a team admin can manage announcements.');
        }
    }

    private function notifyTeam(int $announcementId, string $title, ?string $body, string $severity): void
    {
        foreach ($this->Users->readAllActiveFromTeam() as $teamUser) {
            (new AnnouncementPublished(
                new Users((int) $teamUser['userid'], $this->Users->team),
                $this->Users,
                $announcementId,
                $title,
                $body,
                $severity,
            ))->create();
        }
    }

    /** The SELECT/FROM shared by readAll()/readActive()/readOne(). */
    private static function selectSql(): string
    {
        return 'SELECT announcement.id, announcement.title, announcement.body, announcement.severity,
                announcement.pinned, announcement.userid, announcement.created_at,
                DATE_FORMAT(announcement.expires_at, "%Y-%m-%dT%H:%i:%sZ") AS expires_at,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_announcements AS announcement
            LEFT JOIN users AS author ON author.userid = announcement.userid';
    }

    private function hydrate(array $announcement): array
    {
        $announcement['id'] = (int) $announcement['id'];
        $announcement['userid'] = (int) $announcement['userid'];
        $announcement['pinned'] = (bool) $announcement['pinned'];

        return $announcement;
    }

    private function updateExpiresAt(string $expiresAt): void
    {
        $sql = 'UPDATE custom_announcements SET expires_at = :expires_at WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':expires_at', $expiresAt);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function togglePinned(bool $pinned): void
    {
        $sql = 'UPDATE custom_announcements SET pinned = :pinned WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':pinned', $pinned, PDO::PARAM_BOOL);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function getSeverity(mixed $value): string
    {
        return in_array($value, self::SEVERITIES, true) ? $value : 'info';
    }

    private function getTitle(mixed $value): string
    {
        $title = Filter::toPureString((string) $value);
        if ($title === '' || mb_strlen($title) > 255) {
            throw new ImproperActionException('A title is required and must be shorter than 255 characters.');
        }
        return $title;
    }

    private function getBody(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $body = Filter::toPureString((string) $value);
        if (mb_strlen($body) > 10000) {
            throw new ImproperActionException('Announcement text must be shorter than 10000 characters.');
        }
        return $body;
    }

    private function getExpiresAt(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        try {
            return (new DateTimeImmutable((string) $value))
                ->setTimezone(new DateTimeZone('UTC'))
                ->format('Y-m-d H:i:s');
        } catch (Exception) {
            throw new ImproperActionException('Invalid expiry date.');
        }
    }
}
