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

class OrderCommentsTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    private Orders $Order;

    private OrderComments $OrderComments;

    protected function setUp(): void
    {
        $this->Order = new Orders(new Users(1, 1));
        $id = $this->Order->postAction(Action::Create, array('title' => 'order with comments'));
        $this->Order->setId($id);
        $this->OrderComments = new OrderComments(new Users(1, 1), $this->Order);
    }

    public function testGetApiPath(): void
    {
        $this->assertSame("api/v2/orders/{$this->Order->id}/comments/", $this->OrderComments->getApiPath());
    }

    public function testCreateAndReadOne(): void
    {
        $id = $this->OrderComments->postAction(Action::Create, array('body' => 'quote requested from vendor'));
        $this->assertIsInt($id);
        $this->OrderComments->setId($id);
        $comment = $this->OrderComments->readOne();
        $this->assertSame('quote requested from vendor', $comment['body']);
    }

    public function testRejectEmptyBody(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->OrderComments->postAction(Action::Create, array('body' => ''));
    }

    public function testEditByAuthor(): void
    {
        $id = $this->OrderComments->postAction(Action::Create, array('body' => 'typo in this comment'));
        $this->OrderComments->setId($id);
        $updated = $this->OrderComments->patch(Action::Update, array('body' => 'fixed comment'));
        $this->assertSame('fixed comment', $updated['body']);
    }

    public function testEditRejectsNonAuthorNonAdmin(): void
    {
        $id = $this->OrderComments->postAction(Action::Create, array('body' => 'original'));
        $Other = $this->getUserInTeam(1, admin: 0);
        if ($Other->userid === 1) {
            $this->markTestSkipped('no non-admin, non-author user available in team 1 fixtures');
        }
        $CommentsAsOther = new OrderComments($Other, $this->Order, $id);
        $this->expectException(ImproperActionException::class);
        $CommentsAsOther->patch(Action::Update, array('body' => 'hijacked'));
    }

    public function testDestroyByAuthor(): void
    {
        $id = $this->OrderComments->postAction(Action::Create, array('body' => 'to be removed'));
        $this->OrderComments->setId($id);
        $this->assertTrue($this->OrderComments->destroy());
        $this->expectException(ResourceNotFoundException::class);
        $this->OrderComments->readOne();
    }

    public function testDestroyRejectsNonAuthorNonAdmin(): void
    {
        $id = $this->OrderComments->postAction(Action::Create, array('body' => 'protected comment'));
        $Other = $this->getUserInTeam(1, admin: 0);
        if ($Other->userid === 1) {
            $this->markTestSkipped('no non-admin, non-author user available in team 1 fixtures');
        }
        $CommentsAsOther = new OrderComments($Other, $this->Order, $id);
        $this->expectException(ImproperActionException::class);
        $CommentsAsOther->destroy();
    }

    public function testCommentOnOtherTeamOrderIsRejected(): void
    {
        // OrderComments' readAll() joins on custom_orders WHERE team = :team,
        // so an id from a different team's order must not resolve
        $OrderTeam2 = new Orders(new Users(1, 2));
        $id = $OrderTeam2->postAction(Action::Create, array('title' => 'team 2 order'));
        $OrderTeam2->setId($id);
        $CrossTeamComments = new OrderComments(new Users(1, 1), $OrderTeam2);
        $this->expectException(ResourceNotFoundException::class);
        $CrossTeamComments->postAction(Action::Create, array('body' => 'should not attach'));
    }
}
