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
use Elabftw\Traits\TestsUtilsTrait;

use function array_filter;
use function array_values;

final class FavFiltersTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    private FavFilters $FavFilters;

    private int $statusId;

    protected function setUp(): void
    {
        $User = $this->getRandomUserInTeam(1, 1);
        $this->FavFilters = new FavFilters($User);
        $Status = new ExperimentsStatus(new Teams($User, 1));
        $this->statusId = $Status->postAction(Action::Create, array('name' => 'Favorite filter status'));
    }

    public function testGetApiPath(): void
    {
        $this->assertSame('api/v2/favfilters/', $this->FavFilters->getApiPath());
    }

    public function testCreateReadAndDestroyStatus(): void
    {
        $id = $this->FavFilters->postAction(Action::Create, array(
            'filter_type' => 'status',
            'target_type' => 'experiments',
            'target_id' => $this->statusId,
        ));
        $this->assertGreaterThan(0, $id);
        $this->assertSame($id, $this->FavFilters->postAction(Action::Create, array(
            'filter_type' => 'status',
            'target_type' => 'experiments',
            'target_id' => $this->statusId,
        )));

        $favorite = array_values(array_filter(
            $this->FavFilters->readAll(),
            fn(array $candidate): bool => (int) $candidate['id'] === $id,
        ))[0];
        $this->assertSame('status', $favorite['filter_type']);
        $this->assertSame('experiments', $favorite['target_type']);
        $this->assertSame($this->statusId, (int) $favorite['target_id']);

        $this->FavFilters->setId($id);
        $this->assertTrue($this->FavFilters->destroy());
    }

    public function testCreateOwnerFavorite(): void
    {
        $userId = $this->getRandomUserInTeam(1)->getUserid();
        $id = $this->FavFilters->postAction(Action::Create, array(
            'filter_type' => 'owner',
            'target_type' => 'experiments',
            'target_id' => $userId,
        ));
        $this->assertGreaterThan(0, $id);

        $favorite = array_values(array_filter(
            $this->FavFilters->readAll(),
            fn(array $candidate): bool => (int) $candidate['id'] === $id,
        ))[0];
        $this->assertSame('owner', $favorite['filter_type']);
        $this->assertSame('all', $favorite['target_type']);

        $this->FavFilters->setId($id);
        $this->assertTrue($this->FavFilters->destroy());
    }

    public function testRejectInvalidFilterType(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->FavFilters->postAction(Action::Create, array(
            'filter_type' => 'invalid',
            'target_type' => 'experiments',
            'target_id' => $this->statusId,
        ));
    }
}
