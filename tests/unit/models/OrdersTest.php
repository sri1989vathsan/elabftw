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
use Elabftw\Params\BaseQueryParams;
use Elabftw\Traits\TestsUtilsTrait;
use Elabftw\Models\Users\Users;
use Symfony\Component\HttpFoundation\InputBag;

class OrdersTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    private Orders $Orders;

    protected function setUp(): void
    {
        $this->Orders = new Orders(new Users(1, 1));
    }

    public function testGetApiPath(): void
    {
        $this->assertSame('api/v2/orders/', $this->Orders->getApiPath());
    }

    public function testCreateAndReadOne(): void
    {
        $id = $this->Orders->postAction(Action::Create, array(
            'title' => 'Order some tips',
            'notes' => '200uL and 1000uL',
        ));
        $this->assertIsInt($id);
        $this->Orders->setId($id);
        $order = $this->Orders->readOne();
        $this->assertSame('Order some tips', $order['title']);
        $this->assertSame('200uL and 1000uL', $order['notes']);
        $this->assertSame('requested', $order['status']);
        $this->assertFalse($order['archived']);
        $this->assertSame(array(), $order['items']);
        $this->assertSame(array(), $order['uploads']);
    }

    public function testReadOneUnknownIdThrows(): void
    {
        $this->Orders->setId(999999);
        $this->expectException(ResourceNotFoundException::class);
        $this->Orders->readOne();
    }

    public function testReadOneRejectsOtherTeam(): void
    {
        // an order created in team 1 must not be readable through a team 2 instance,
        // even by its exact id
        $id = $this->Orders->postAction(Action::Create, array('title' => 'team 1 only'));
        $OrdersTeam2 = new Orders(new Users(1, 2));
        $OrdersTeam2->setId($id);
        $this->expectException(ResourceNotFoundException::class);
        $OrdersTeam2->readOne();
    }

    public function testRejectEmptyTitle(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->Orders->postAction(Action::Create, array('title' => ''));
    }

    public function testUpdateStatus(): void
    {
        $id = $this->Orders->postAction(Action::Create, array('title' => 'status test'));
        $this->Orders->setId($id);
        $updated = $this->Orders->patch(Action::Update, array('status' => 'ordered'));
        $this->assertSame('ordered', $updated['status']);
    }

    public function testUpdateRejectsInvalidStatus(): void
    {
        $id = $this->Orders->postAction(Action::Create, array('title' => 'bad status'));
        $this->Orders->setId($id);
        $this->expectException(ImproperActionException::class);
        $this->Orders->patch(Action::Update, array('status' => 'not-a-real-status'));
    }

    public function testUpdateArchived(): void
    {
        $id = $this->Orders->postAction(Action::Create, array('title' => 'archive test'));
        $this->Orders->setId($id);
        $updated = $this->Orders->patch(Action::Update, array('archived' => true));
        $this->assertTrue($updated['archived']);
        $updated = $this->Orders->patch(Action::Update, array('archived' => false));
        $this->assertFalse($updated['archived']);
    }

    public function testOnlyOwnerOrAdminCanEditContent(): void
    {
        // owner (userid 1, admin) creates it -- a non-admin, non-owner
        // team member must not be able to edit title/notes
        $id = $this->Orders->postAction(Action::Create, array('title' => 'owned by user 1'));
        $NonOwner = $this->getUserInTeam(1, admin: 0);
        if ($NonOwner->userid === 1) {
            $this->markTestSkipped('no non-admin, non-owner user available in team 1 fixtures');
        }
        $OrdersAsOther = new Orders($NonOwner, $id);
        $this->expectException(ImproperActionException::class);
        $OrdersAsOther->patch(Action::Update, array('title' => 'hijacked'));
    }

    public function testAnyTeamMemberCanChangeStatus(): void
    {
        // status/archived are not owner-gated -- any team member handling
        // the actual purchasing workflow can move an order along
        $id = $this->Orders->postAction(Action::Create, array('title' => 'team-movable'));
        $Other = $this->getUserInTeam(1, admin: 0);
        if ($Other->userid === 1) {
            $this->markTestSkipped('no other user available in team 1 fixtures');
        }
        $OrdersAsOther = new Orders($Other, $id);
        $updated = $OrdersAsOther->patch(Action::Update, array('status' => 'received'));
        $this->assertSame('received', $updated['status']);
    }

    public function testDestroyByOwner(): void
    {
        $id = $this->Orders->postAction(Action::Create, array('title' => 'to be deleted'));
        $this->Orders->setId($id);
        $this->assertTrue($this->Orders->destroy());
        $this->expectException(ResourceNotFoundException::class);
        $this->Orders->readOne();
    }

    public function testDestroyRejectsNonOwnerNonAdmin(): void
    {
        $id = $this->Orders->postAction(Action::Create, array('title' => 'protected'));
        $NonOwner = $this->getUserInTeam(1, admin: 0);
        if ($NonOwner->userid === 1) {
            $this->markTestSkipped('no non-admin, non-owner user available in team 1 fixtures');
        }
        $OrdersAsOther = new Orders($NonOwner, $id);
        $this->expectException(ImproperActionException::class);
        $OrdersAsOther->destroy();
    }

    public function testLinkAndUnlinkItems(): void
    {
        $Item = $this->getFreshItem(1);
        $id = $this->Orders->postAction(Action::Create, array(
            'title' => 'with resource',
            'item_ids' => array($Item->id),
        ));
        $this->Orders->setId($id);
        $order = $this->Orders->readOne();
        $this->assertCount(1, $order['items']);
        $this->assertSame($Item->id, $order['items'][0]['id']);

        // patching item_ids fully replaces the set, same idea as the
        // canread/canwrite editors
        $updated = $this->Orders->patch(Action::Update, array('item_ids' => array()));
        $this->assertSame(array(), $updated['items']);
    }

    public function testFilterByStatusAndArchived(): void
    {
        $requestedId = $this->Orders->postAction(Action::Create, array('title' => 'filter: requested'));
        $orderedId = $this->Orders->postAction(Action::Create, array('title' => 'filter: ordered'));
        $this->Orders->setId($orderedId);
        $this->Orders->patch(Action::Update, array('status' => 'ordered'));
        $archivedId = $this->Orders->postAction(Action::Create, array('title' => 'filter: archived'));
        $this->Orders->setId($archivedId);
        $this->Orders->patch(Action::Update, array('archived' => true));

        $requested = $this->Orders->readAll(new BaseQueryParams(new InputBag(array('status' => 'requested'))));
        $requestedIds = array_column($requested, 'id');
        $this->assertContains($requestedId, $requestedIds);
        $this->assertNotContains($orderedId, $requestedIds);
        $this->assertNotContains($archivedId, $requestedIds);

        $archived = $this->Orders->readAll(new BaseQueryParams(new InputBag(array('status' => 'archived'))));
        $archivedIds = array_column($archived, 'id');
        $this->assertContains($archivedId, $archivedIds);
        $this->assertNotContains($requestedId, $archivedIds);
    }

    public function testPaginationLimitAndOffset(): void
    {
        for ($i = 0; $i < 3; $i++) {
            $this->Orders->postAction(Action::Create, array('title' => "page test {$i}"));
        }
        // requesting limit=1 should ask readAll() for one extra row so the
        // frontend can tell there's a next page without a separate COUNT
        $page = $this->Orders->readAll(new BaseQueryParams(new InputBag(array('limit' => '1'))));
        $this->assertGreaterThanOrEqual(2, count($page));
    }

    public function testSearchMatchesTitleAcrossAllResults(): void
    {
        $needle = 'zzz-unique-search-term-zzz';
        $id = $this->Orders->postAction(Action::Create, array('title' => "order with {$needle}"));
        // a small limit still finds the match: search is applied in SQL
        // before pagination, not filtered client-side on a loaded page
        $results = $this->Orders->readAll(new BaseQueryParams(new InputBag(array(
            'search' => $needle,
            'limit' => '1',
        ))));
        $this->assertContains($id, array_column($results, 'id'));
    }

    public function testSearchMatchesComments(): void
    {
        $needle = 'zzz-comment-search-zzz';
        $id = $this->Orders->postAction(Action::Create, array('title' => 'searchable via comment'));
        $OrderComments = new OrderComments(new Users(1, 1), $this->Orders);
        $OrderComments->postAction(Action::Create, array('body' => "note: {$needle}"));

        $results = $this->Orders->readAll(new BaseQueryParams(new InputBag(array('search' => $needle))));
        $this->assertContains($id, array_column($results, 'id'));
    }

    public function testSearchDoesNotLeakOtherTeamOrders(): void
    {
        $needle = 'zzz-team-isolated-zzz';
        $this->Orders->postAction(Action::Create, array('title' => "team 1 {$needle}"));
        $OrdersTeam2 = new Orders(new Users(1, 2));
        $results = $OrdersTeam2->readAll(new BaseQueryParams(new InputBag(array('search' => $needle))));
        $this->assertSame(array(), $results);
    }

    public function testNonAdminCannotFilterByUserid(): void
    {
        // the userid filter is admin-only, enforced server-side -- a non-admin
        // passing it must simply have it ignored, not error or leak results
        // scoped to someone else
        $id = $this->Orders->postAction(Action::Create, array('title' => 'admin filter test'));
        $NonAdmin = $this->getUserInTeam(1, admin: 0);
        if ($NonAdmin->userid === 1) {
            $this->markTestSkipped('no non-admin user available in team 1 fixtures');
        }
        $OrdersAsNonAdmin = new Orders($NonAdmin);
        $results = $OrdersAsNonAdmin->readAll(new BaseQueryParams(new InputBag(array('userid' => '999999'))));
        // ignored filter means the normal team-scoped list is returned
        $this->assertContains($id, array_column($results, 'id'));
    }
}
