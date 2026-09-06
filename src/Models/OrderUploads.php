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
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;
use RuntimeException;
use Symfony\Component\HttpFoundation\File\UploadedFile;

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
 * Attachments (receipts, quotes, ...) on an order. Files are written to the
 * instance's configured storage backend the same way the native uploads
 * table does, and served back through the existing app/download.php
 * endpoint, so no new download code path is needed.
 */
final class OrderUploads extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private Orders $Order, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/orders/%d/uploads/', $this->Order->id ?? 0);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        if ($action !== Action::Create) {
            throw new ImproperActionException('Invalid action for order upload creation.');
        }
        // make sure the order actually belongs to our team before writing anything
        $this->Order->readOne();

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

        $sql = 'INSERT INTO custom_order_uploads (order_id, userid, real_name, long_name, storage, filesize)
            VALUES (:order_id, :userid, :real_name, :long_name, :storage, :filesize)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
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
        $sql = 'SELECT upload.id, upload.real_name, upload.long_name, upload.storage, upload.filesize, upload.created_at, upload.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_order_uploads AS upload
            INNER JOIN custom_orders AS o ON o.id = upload.order_id AND o.team = :team
            LEFT JOIN users AS author ON author.userid = upload.userid
            WHERE upload.order_id = :order_id
            ORDER BY upload.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        $result = $req->fetchAll();
        foreach ($result as &$upload) {
            $upload['id'] = (int) $upload['id'];
            $upload['userid'] = (int) $upload['userid'];
            $upload['storage'] = (int) $upload['storage'];
        }

        return $result;
    }

    #[Override]
    public function readOne(): array
    {
        foreach ($this->readAll() as $upload) {
            if ($upload['id'] === $this->id) {
                return $upload;
            }
        }
        throw new ResourceNotFoundException();
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
        $sql = 'DELETE FROM custom_order_uploads WHERE id = :id AND order_id = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }
}
