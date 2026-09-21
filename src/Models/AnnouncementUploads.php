<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Tools;
use Elabftw\Enums\Action;
use Elabftw\Enums\Storage;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;
use RuntimeException;
use Symfony\Component\HttpFoundation\File\UploadedFile;

use function array_map;
use function fclose;
use function fopen;
use function mb_strtolower;
use function mb_substr;
use function pathinfo;
use function rewind;
use function sprintf;
use function stream_copy_to_stream;
use function stream_get_meta_data;

use const PATHINFO_EXTENSION;

/**
 * An image attached to an announcement (as a real uploaded file, not just a
 * pasted image_url). Files are written to the instance's configured storage
 * backend the same way the native uploads table does, and served back
 * through the existing app/download.php endpoint -- see custom_order_uploads/
 * OrderUploads, which this mirrors (minus its order-specific PDF text
 * extraction, irrelevant here).
 */
final class AnnouncementUploads extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private Announcements $Announcement, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/announcements/%d/uploads/', $this->Announcement->id ?? 0);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        if ($action !== Action::Create) {
            throw new ImproperActionException('Invalid action for announcement upload creation.');
        }
        // make sure the announcement actually belongs to our team before writing anything
        $this->Announcement->readOne();

        $file = $reqBody['file'] ?? null;
        if (!$file instanceof UploadedFile) {
            throw new ImproperActionException('Error reading file!');
        }
        $realName = (string) ($reqBody['real_name'] ?? $file->getClientOriginalName());
        $ext = mb_strtolower(pathinfo($realName, PATHINFO_EXTENSION) ?: 'bin');

        $someRandomString = Tools::getUuidv4();
        $folder = mb_substr($someRandomString, 0, 2);
        $longName = sprintf('%s/%s.%s', $folder, $someRandomString, $ext);

        $storageId = (int) Config::getConfig()->configArr['uploads_storage'];
        $storageFs = Storage::from($storageId)->getStorage()->getFs();

        $filesize = $file->getSize();
        $inputStream = fopen($file->getPathname(), 'rb');
        if ($inputStream === false) {
            throw new RuntimeException('Could not read uploaded file.');
        }
        $meta = stream_get_meta_data($inputStream);
        if (empty($meta['seekable'])) {
            $tmp = fopen('php://temp', 'w+b');
            if ($tmp === false) {
                throw new RuntimeException('Could not create temporary seekable stream.');
            }
            stream_copy_to_stream($inputStream, $tmp);
            fclose($inputStream);
            $inputStream = $tmp;
            rewind($inputStream);
        }
        $storageFs->createDirectory($folder);
        $storageFs->writeStream($longName, $inputStream);
        fclose($inputStream);

        $sql = 'INSERT INTO custom_announcement_uploads (announcement_id, userid, real_name, long_name, storage, filesize)
            VALUES (:announcement_id, :userid, :real_name, :long_name, :storage, :filesize)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':announcement_id', $this->Announcement->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':real_name', $realName);
        $req->bindValue(':long_name', $longName);
        $req->bindValue(':storage', $storageId, PDO::PARAM_INT);
        $req->bindValue(':filesize', $filesize, PDO::PARAM_INT);
        $this->Db->execute($req);

        return (int) $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = self::selectSql() . '
            WHERE upload.announcement_id = :announcement_id
            ORDER BY upload.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':announcement_id', $this->Announcement->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        $sql = self::selectSql() . ' WHERE upload.id = :id AND upload.announcement_id = :announcement_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':announcement_id', $this->Announcement->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $upload = $this->Db->fetch($req);

        return $this->hydrate($upload);
    }

    #[Override]
    public function destroy(): bool
    {
        $upload = $this->readOne();
        if ($upload['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the person who added it or a team admin can delete this attachment.');
        }
        try {
            $storageFs = Storage::from($upload['storage'])->getStorage()->getFs();
            $storageFs->delete($upload['long_name']);
        } catch (RuntimeException) {
            // if the physical file is already gone, still remove the db row below
        }
        $sql = 'DELETE FROM custom_announcement_uploads WHERE id = :id AND announcement_id = :announcement_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':announcement_id', $this->Announcement->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    /** The SELECT/FROM/JOIN shared by readAll() and readOne(). */
    private static function selectSql(): string
    {
        return 'SELECT upload.id, upload.real_name, upload.long_name, upload.storage, upload.filesize, upload.created_at, upload.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_announcement_uploads AS upload
            INNER JOIN custom_announcements AS a ON a.id = upload.announcement_id AND a.team = :team
            LEFT JOIN users AS author ON author.userid = upload.userid';
    }

    private function hydrate(array $upload): array
    {
        $upload['id'] = (int) $upload['id'];
        $upload['userid'] = (int) $upload['userid'];
        $upload['storage'] = (int) $upload['storage'];

        return $upload;
    }
}
