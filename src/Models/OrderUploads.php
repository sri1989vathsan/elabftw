<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Elabftw\Invoker;
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
use Smalot\PdfParser\Parser as PdfParser;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Throwable;

use function array_column;
use function array_map;
use function fclose;
use function fopen;
use function mb_strtolower;
use function mb_substr;
use function pathinfo;
use function preg_match;
use function rewind;
use function sprintf;
use function stream_copy_to_stream;
use function stream_get_meta_data;
use function trim;

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
        // Extraction runs out-of-band (see extractOne()) instead of inline
        // here -- a large PDF could otherwise make the upload request slow
        // or hit its time/memory limit.
        $extractionStatus = $ext === 'pdf' ? 'pending' : 'none';

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

        $sql = 'INSERT INTO custom_order_uploads (order_id, userid, real_name, long_name, storage, filesize, extraction_status)
            VALUES (:order_id, :userid, :real_name, :long_name, :storage, :filesize, :extraction_status)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':real_name', $realName);
        $req->bindValue(':long_name', $longName);
        $req->bindValue(':storage', $storageId, PDO::PARAM_INT);
        $req->bindValue(':filesize', $filesize, PDO::PARAM_INT);
        $req->bindValue(':extraction_status', $extractionStatus);
        $this->Db->execute($req);
        $uploadId = (int) $this->Db->lastInsertId();

        if ($extractionStatus === 'pending') {
            // best-effort: if the invoker isn't reachable (e.g. in a test
            // environment) the upload still succeeds, it just stays
            // 'pending' until a catch-up sweep (orders:extract-pdf with no
            // id) picks it up
            try {
                (new Invoker())->write(sprintf('orders:extract-pdf %d', $uploadId));
            } catch (RuntimeException) {
                // swallowed on purpose, see above
            }
        }

        return $uploadId;
    }

    /**
     * Run PDF text extraction for one upload. Called from the async
     * orders:extract-pdf command (right after upload, or as a catch-up
     * sweep), which runs outside of any HTTP request/team context -- so
     * unlike the rest of this class, this doesn't go through readOne() or
     * bind to a particular team.
     */
    public static function extractOne(int $uploadId): void
    {
        $Db = Db::getConnection();
        // atomically claim it: an UPDATE that only matches while still
        // 'pending' means at most one caller ever moves it to
        // 'processing', so the invoker-dispatched run and a manual
        // catch-up sweep racing each other can't both extract the same PDF
        $claimReq = $Db->prepare(
            "UPDATE custom_order_uploads SET extraction_status = 'processing' WHERE id = :id AND extraction_status = 'pending'",
        );
        $claimReq->bindValue(':id', $uploadId, PDO::PARAM_INT);
        $Db->execute($claimReq);
        if ($claimReq->rowCount() === 0) {
            // already claimed/processed by another run, or not pending in
            // the first place -- nothing to do
            return;
        }

        $sql = 'SELECT id, order_id, long_name, storage FROM custom_order_uploads WHERE id = :id';
        $req = $Db->prepare($sql);
        $req->bindValue(':id', $uploadId, PDO::PARAM_INT);
        $Db->execute($req);
        $upload = $req->fetch();

        $status = 'failed';
        $extractedText = null;
        try {
            $storageFs = Storage::from((int) $upload['storage'])->getStorage()->getFs();
            $text = trim((new PdfParser())->parseContent($storageFs->read($upload['long_name']))->getText());
            $extractedText = $text === '' ? null : $text;
            // "done" covers both a found text layer and a genuinely empty
            // one (e.g. scanned/image-only pages) -- either way, extraction
            // ran to completion. Only a thrown exception below means failed.
            $status = 'done';
        } catch (Throwable) {
            // encrypted, corrupted, or otherwise unparseable -- the upload
            // itself already succeeded, it just isn't searchable by content
        }

        $sql = 'UPDATE custom_order_uploads SET extracted_text = :extracted_text, extraction_status = :status WHERE id = :id';
        $req = $Db->prepare($sql);
        $req->bindValue(':extracted_text', $extractedText, $extractedText === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':status', $status);
        $req->bindValue(':id', $uploadId, PDO::PARAM_INT);
        $Db->execute($req);

        if ($extractedText !== null) {
            self::extractProcurementTags($Db, (int) $upload['order_id'], $extractedText);
        }
    }

    /**
     * A supplier/procurement order confirmation PDF (e.g. ETH Zurich's) has
     * a "Beschaffungs-ID" (procurement id) and a "Bestellung Nr."
     * (purchase order number) near the top -- pull those out and store them
     * on the order so they show as tags and are searchable, without the
     * user having to type them in by hand. Best-effort: a PDF that isn't in
     * this format just leaves the fields unset.
     */
    private static function extractProcurementTags(Db $Db, int $orderId, string $text): void
    {
        // ETH Zurich's form draws each value directly before its own label
        // with no separator (e.g. "26036220Beschaffungs-ID"), not after it
        // -- so that ordering is tried first, falling back to label-then-
        // value in case some other supplier's PDF lays it out the other way.
        $procurementId = null;
        $orderNumber = null;
        if (preg_match('/(\d+)\s{0,1}Beschaffungs-ID/i', $text, $matches) === 1
            || preg_match('/Beschaffungs-ID\s+(\S+)/i', $text, $matches) === 1
        ) {
            $procurementId = $matches[1];
        }
        if (preg_match('/(\d+)\s{0,1}Bestellung\s*(?:Nr|No)\.?/i', $text, $matches) === 1
            || preg_match('/Bestellung\s*(?:Nr|No)\.?\s+(\S+)/i', $text, $matches) === 1
        ) {
            $orderNumber = $matches[1];
        }
        if ($procurementId === null && $orderNumber === null) {
            return;
        }
        $sql = 'UPDATE custom_orders SET
                procurement_id = COALESCE(:procurement_id, procurement_id),
                order_number = COALESCE(:order_number, order_number)
            WHERE id = :order_id';
        $req = $Db->prepare($sql);
        $req->bindValue(':procurement_id', $procurementId, $procurementId === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':order_number', $orderNumber, $orderNumber === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':order_id', $orderId, PDO::PARAM_INT);
        $Db->execute($req);
    }

    /** @return list<int> upload ids still waiting on extraction */
    public static function pendingIds(): array
    {
        $Db = Db::getConnection();
        $req = $Db->prepare("SELECT id FROM custom_order_uploads WHERE extraction_status = 'pending'");
        $Db->execute($req);
        return array_map('intval', array_column($req->fetchAll(), 'id'));
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = self::selectSql() . '
            WHERE upload.order_id = :order_id
            ORDER BY upload.created_at ASC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return array_map($this->hydrate(...), $req->fetchAll());
    }

    /** The SELECT/FROM/JOIN shared by readAll() and readOne(). */
    private static function selectSql(): string
    {
        return 'SELECT upload.id, upload.real_name, upload.long_name, upload.storage, upload.filesize, upload.created_at, upload.userid,
                (upload.extracted_text IS NOT NULL) AS has_extracted_text,
                upload.extraction_status,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname
            FROM custom_order_uploads AS upload
            INNER JOIN custom_orders AS o ON o.id = upload.order_id AND o.team = :team
            LEFT JOIN users AS author ON author.userid = upload.userid';
    }

    private function hydrate(array $upload): array
    {
        $upload['id'] = (int) $upload['id'];
        $upload['userid'] = (int) $upload['userid'];
        $upload['storage'] = (int) $upload['storage'];
        $upload['has_extracted_text'] = (bool) $upload['has_extracted_text'];

        return $upload;
    }

    #[Override]
    public function readOne(): array
    {
        $sql = self::selectSql() . ' WHERE upload.id = :id AND upload.order_id = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);
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
        $sql = 'DELETE FROM custom_order_uploads WHERE id = :id AND order_id = :order_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':order_id', $this->Order->id, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }
}
