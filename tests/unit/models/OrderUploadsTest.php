<?php

declare(strict_types=1);
/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Traits\TestsUtilsTrait;
use Elabftw\Models\Users\Users;
use Symfony\Component\HttpFoundation\File\UploadedFile;

use function file_put_contents;
use function sys_get_temp_dir;
use function tempnam;
use function unlink;

class OrderUploadsTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    private array $tmpFiles = array();

    private Orders $Order;

    private OrderUploads $OrderUploads;

    protected function setUp(): void
    {
        $this->Order = new Orders(new Users(1, 1));
        $id = $this->Order->postAction(Action::Create, array('title' => 'order with uploads'));
        $this->Order->setId($id);
        $this->OrderUploads = new OrderUploads(new Users(1, 1), $this->Order);
    }

    protected function tearDown(): void
    {
        foreach ($this->tmpFiles as $tmpFile) {
            if (file_exists($tmpFile)) {
                unlink($tmpFile);
            }
        }
    }

    private function getUploadedFile(string $contents, string $clientName): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'elabftw-order-upload-test-');
        $this->assertIsString($path);
        $this->assertNotFalse(file_put_contents($path, $contents));
        $this->tmpFiles[] = $path;

        return new UploadedFile($path, $clientName, null, null, true);
    }

    public function testGetApiPath(): void
    {
        $this->assertSame("api/v2/orders/{$this->Order->id}/uploads/", $this->OrderUploads->getApiPath());
    }

    public function testCreateAndReadOne(): void
    {
        $file = $this->getUploadedFile('a quote, not really a pdf', 'quote.txt');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        $this->assertIsInt($id);
        $this->OrderUploads->setId($id);
        $upload = $this->OrderUploads->readOne();
        $this->assertSame('quote.txt', $upload['real_name']);
        $this->assertFalse($upload['has_extracted_text']);
        // not a PDF -- nothing queued for extraction
        $this->assertSame('none', $upload['extraction_status']);
    }

    public function testPdfUploadIsQueuedForExtraction(): void
    {
        // extraction itself runs out-of-band (see extractOne()); postAction()
        // only needs to leave it in the 'pending' state, not run it inline
        $file = $this->getUploadedFile('not a real pdf structure', 'quote.pdf');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        $this->OrderUploads->setId($id);
        $upload = $this->OrderUploads->readOne();
        $this->assertSame('pending', $upload['extraction_status']);
        $this->assertFalse($upload['has_extracted_text']);
    }

    public function testExtractOneMarksUnparseablePdfAsFailed(): void
    {
        // a PDF that isn't actually a valid PDF structure -- extraction must
        // fail gracefully (upload itself already succeeded) rather than throw
        $file = $this->getUploadedFile('not a real pdf structure', 'unparseable.pdf');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        OrderUploads::extractOne($id);
        $this->OrderUploads->setId($id);
        $upload = $this->OrderUploads->readOne();
        $this->assertSame('failed', $upload['extraction_status']);
        $this->assertFalse($upload['has_extracted_text']);
    }

    public function testExtractOneIsIdempotentOnceProcessed(): void
    {
        // a catch-up sweep must not redo (or overwrite) work a previous run
        // already finished
        $file = $this->getUploadedFile('not a real pdf structure', 'once.pdf');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        OrderUploads::extractOne($id);
        $this->assertNotContains($id, OrderUploads::pendingIds());
        // calling it again on an already-processed upload is a no-op, not
        // an error
        OrderUploads::extractOne($id);
        $this->OrderUploads->setId($id);
        $this->assertSame('failed', $this->OrderUploads->readOne()['extraction_status']);
    }

    public function testRejectMissingFile(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->OrderUploads->postAction(Action::Create, array());
    }

    public function testDestroyByUploader(): void
    {
        $file = $this->getUploadedFile('to be removed', 'delete-me.txt');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        $this->OrderUploads->setId($id);
        $this->assertTrue($this->OrderUploads->destroy());
        $this->expectException(ResourceNotFoundException::class);
        $this->OrderUploads->readOne();
    }

    public function testDestroyRejectsNonUploaderNonAdmin(): void
    {
        $file = $this->getUploadedFile('protected', 'protected.txt');
        $id = $this->OrderUploads->postAction(Action::Create, array('file' => $file));
        $Other = $this->getUserInTeam(1, admin: 0);
        if ($Other->userid === 1) {
            $this->markTestSkipped('no non-admin, non-uploader user available in team 1 fixtures');
        }
        $UploadsAsOther = new OrderUploads($Other, $this->Order, $id);
        $this->expectException(ImproperActionException::class);
        $UploadsAsOther->destroy();
    }

    public function testUploadToOtherTeamOrderIsRejected(): void
    {
        $OrderTeam2 = new Orders(new Users(1, 2));
        $team2OrderId = $OrderTeam2->postAction(Action::Create, array('title' => 'team 2 order'));

        // simulate the real attack path: a team 1 requester hits
        // /orders/{team2OrderId}/uploads -- the router always scopes Orders
        // to the REQUESTER's own team, so this Orders instance (unlike
        // $OrderTeam2 above) is team 1 even though the id belongs to team 2
        $OrderAsSeenByTeam1Requester = new Orders(new Users(1, 1), $team2OrderId);
        $CrossTeamUploads = new OrderUploads(new Users(1, 1), $OrderAsSeenByTeam1Requester);
        $file = $this->getUploadedFile('should not attach', 'leak.txt');
        $this->expectException(ResourceNotFoundException::class);
        $CrossTeamUploads->postAction(Action::Create, array('file' => $file));
    }
}
