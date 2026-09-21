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

use function array_column;
use function array_key_exists;
use function filter_var;
use function htmlspecialchars;
use function implode;
use function in_array;
use function mb_strlen;
use function str_starts_with;
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

    /**
     * The only emoji a reaction can be -- keeps the reaction bar a fixed,
     * predictable row instead of a full picker. A reader can pick more
     * than one of these on the same announcement (see toggleReaction()).
     */
    private const array REACTIONS = array('👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '👏', '🔥', '🙌', '🤔', '👀');

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
        $imageUrl = $this->getImageUrl($reqBody['image_url'] ?? null);
        $expiresAt = $this->getExpiresAt($reqBody['expires_at'] ?? null);
        // a checkbox's collectForm() value is the string 'on'/'off', not a
        // real boolean -- (bool) 'off' is true in PHP, same trap
        // Filter::toBinary() already exists to avoid.
        $pinned = (bool) Filter::toBinary($reqBody['pinned'] ?? false);

        $sql = 'INSERT INTO custom_announcements (team, userid, title, body, image_url, severity, expires_at, pinned)
            VALUES (:team, :userid, :title, :body, :image_url, :severity, :expires_at, :pinned)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':image_url', $imageUrl, $imageUrl === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':severity', $severity);
        $req->bindValue(':expires_at', $expiresAt, $expiresAt === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':pinned', $pinned, PDO::PARAM_BOOL);
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

        return $this->attachReactions(array_map($this->hydrate(...), $req->fetchAll()));
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

        return $this->attachReactions(array_map($this->hydrate(...), $req->fetchAll()));
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

        return $this->attachReactions(array($this->hydrate($announcement)))[0];
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        // reacting is the one action any team member can do, not just an admin
        if ($action === Action::React) {
            $this->readOne();
            $this->toggleReaction($this->getEmoji($params['emoji'] ?? null));
            return $this->readOne();
        }

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
        $imageUrl = array_key_exists('image_url', $params) ? $this->getImageUrl($params['image_url']) : $announcement['image_url'];
        $severity = array_key_exists('severity', $params) ? $this->getSeverity($params['severity']) : $announcement['severity'];
        $expiresAt = array_key_exists('expires_at', $params) ? $this->getExpiresAt($params['expires_at']) : $announcement['expires_at'];

        $sql = 'UPDATE custom_announcements SET title = :title, body = :body, image_url = :image_url, severity = :severity, expires_at = :expires_at
            WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':body', $body, $body === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':image_url', $imageUrl, $imageUrl === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
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
        return 'SELECT announcement.id, announcement.title, announcement.body, announcement.image_url, announcement.severity,
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
        // the textarea is stored as plain text (toPureString()); bare URLs
        // are only turned into clickable links here, at render time
        $announcement['body_html'] = $announcement['body'] !== null
            ? Filter::linkify(htmlspecialchars($announcement['body'], ENT_QUOTES, 'UTF-8'))
            : null;

        return $announcement;
    }

    /**
     * Add each announcement's reaction counts (emoji => how many) and the
     * current user's own reactions (a list, possibly more than one), in
     * one extra query per list instead of one per row.
     */
    private function attachReactions(array $announcements): array
    {
        if ($announcements === array()) {
            return $announcements;
        }
        $ids = implode(',', array_column($announcements, 'id'));

        $counts = array();
        $req = $this->Db->q("SELECT announcement_id, emoji, COUNT(*) AS reaction_count
            FROM custom_announcement_reactions
            WHERE announcement_id IN ($ids)
            GROUP BY announcement_id, emoji");
        while ($row = $req->fetch(PDO::FETCH_ASSOC)) {
            $counts[(int) $row['announcement_id']][(string) $row['emoji']] = (int) $row['reaction_count'];
        }

        $mine = array();
        $sqlMine = "SELECT announcement_id, emoji FROM custom_announcement_reactions
            WHERE announcement_id IN ($ids) AND userid = :userid";
        $reqMine = $this->Db->prepare($sqlMine);
        $reqMine->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $this->Db->execute($reqMine);
        while ($row = $reqMine->fetch(PDO::FETCH_ASSOC)) {
            $mine[(int) $row['announcement_id']][] = (string) $row['emoji'];
        }

        foreach ($announcements as &$announcement) {
            $announcement['reactions'] = $counts[$announcement['id']] ?? array();
            $announcement['my_reactions'] = $mine[$announcement['id']] ?? array();
        }
        unset($announcement);

        return $announcements;
    }

    /**
     * Picking a reaction you already have removes it; picking one you
     * don't have adds it alongside any others you've already picked on
     * this same announcement -- more than one reaction per user is fine,
     * just not the same one twice.
     */
    private function toggleReaction(string $emoji): void
    {
        $req = $this->Db->prepare('SELECT 1 FROM custom_announcement_reactions WHERE announcement_id = :id AND userid = :userid AND emoji = :emoji');
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':emoji', $emoji);
        $this->Db->execute($req);

        if ($req->fetch(PDO::FETCH_COLUMN) !== false) {
            $delete = $this->Db->prepare('DELETE FROM custom_announcement_reactions WHERE announcement_id = :id AND userid = :userid AND emoji = :emoji');
            $delete->bindParam(':id', $this->id, PDO::PARAM_INT);
            $delete->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
            $delete->bindValue(':emoji', $emoji);
            $this->Db->execute($delete);
            return;
        }

        $insert = $this->Db->prepare('INSERT INTO custom_announcement_reactions (announcement_id, userid, emoji) VALUES (:id, :userid, :emoji)');
        $insert->bindParam(':id', $this->id, PDO::PARAM_INT);
        $insert->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $insert->bindValue(':emoji', $emoji);
        $this->Db->execute($insert);
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

    private function getImageUrl(mixed $value): ?string
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        $url = trim((string) $value);
        if (mb_strlen($url) > 2048) {
            throw new ImproperActionException('Invalid image URL.');
        }
        // Either a normal http(s) URL (pasted in by hand), or our own
        // app/download.php?... link (AnnouncementUploads sets this after a
        // real file upload -- see upload-announcement-image in admin.ts):
        // site-relative, so it never passes FILTER_VALIDATE_URL/str_starts_with('http').
        $isHttpUrl = filter_var($url, FILTER_VALIDATE_URL) !== false && str_starts_with($url, 'http');
        $isOwnDownloadLink = str_starts_with($url, 'app/download.php?');
        if (!$isHttpUrl && !$isOwnDownloadLink) {
            throw new ImproperActionException('Invalid image URL.');
        }
        return $url;
    }

    private function getEmoji(mixed $value): string
    {
        if (!in_array($value, self::REACTIONS, true)) {
            throw new ImproperActionException('Invalid reaction.');
        }
        return $value;
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
