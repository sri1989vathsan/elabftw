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
 * Files attached to an order template. Written to the instance's configured storage and served
 * back through app/download.php, like order attachments. Only the template's author or a team
 * admin can add or remove files; everyone in the team can open them.
 */
final class OrderTemplateUploads extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, private OrderTemplates $Template, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('api/v2/order_templates/%d/uploads/', $this->Template->id ?? 0);
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        if ($action !== Action::Create) {
            throw new ImproperActionException('Invalid action for template upload creation.');
        }
        $this->assertCanEdit();
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

        $sql = 'INSERT INTO custom_order_template_uploads (template_id, userid, real_name, long_name, storage, filesize)
            VALUES (:template_id, :userid, :real_name, :long_name, :storage, :filesize)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':template_id', (int) $this->Template->id, PDO::PARAM_INT);
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
        $this->Template->readOne(); // same team only
        $sql = self::selectSql() . ' WHERE upload.template_id = :template_id ORDER BY upload.created_at ASC, upload.id ASC';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':template_id', (int) $this->Template->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        $this->Template->readOne();
        $sql = self::selectSql() . ' WHERE upload.id = :id AND upload.template_id = :template_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':template_id', (int) $this->Template->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $req->fetch();
        if ($row === false) {
            throw new ResourceNotFoundException();
        }

        return $this->hydrate($row);
    }

    #[Override]
    public function destroy(): bool
    {
        $this->assertCanEdit();
        $upload = $this->readOne();
        try {
            Storage::from($upload['storage'])->getStorage()->getFs()->delete($upload['long_name']);
        } catch (RuntimeException) {
            // the physical file is already gone: still remove the row below
        }
        $sql = 'DELETE FROM custom_order_template_uploads WHERE id = :id AND template_id = :template_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':template_id', (int) $this->Template->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private static function selectSql(): string
    {
        return 'SELECT upload.id, upload.real_name, upload.long_name, upload.storage, upload.filesize, upload.created_at, upload.userid
            FROM custom_order_template_uploads AS upload';
    }

    /** @param array<string, mixed> $upload */
    private function hydrate(array $upload): array
    {
        $upload['id'] = (int) $upload['id'];
        $upload['userid'] = (int) $upload['userid'];
        $upload['storage'] = (int) $upload['storage'];
        $upload['filesize'] = $upload['filesize'] === null ? null : (int) $upload['filesize'];

        return $upload;
    }

    private function assertCanEdit(): void
    {
        if (!$this->Template->readOne()['can_edit']) {
            throw new ImproperActionException('Only the author or a team admin can change the files of this template.');
        }
    }
}
