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

final class FavCategoriesTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    private FavCategories $FavCategories;

    private int $categoryId;

    protected function setUp(): void
    {
        $User = $this->getRandomUserInTeam(1, 1);
        $this->FavCategories = new FavCategories($User);
        $Categories = new ExperimentsCategories(new Teams($User, 1));
        $this->categoryId = $Categories->create('Favorite category test');
    }

    public function testGetApiPath(): void
    {
        $this->assertSame('api/v2/favcategories/', $this->FavCategories->getApiPath());
    }

    public function testCreateReadAndDestroy(): void
    {
        $id = $this->FavCategories->postAction(Action::Create, array(
            'category_id' => $this->categoryId,
            'category_type' => 'experiments',
        ));
        $this->assertGreaterThan(0, $id);
        $this->assertSame($id, $this->FavCategories->postAction(Action::Create, array(
            'category_id' => $this->categoryId,
            'category_type' => 'experiments',
        )));

        $favorite = array_values(array_filter(
            $this->FavCategories->readAll(),
            fn(array $candidate): bool => (int) $candidate['id'] === $id,
        ))[0];
        $this->assertSame('experiments', $favorite['category_type']);
        $this->assertSame($this->categoryId, (int) $favorite['category_id']);

        $this->FavCategories->setId($id);
        $this->assertTrue($this->FavCategories->destroy());
    }

    public function testRejectInvalidCategoryType(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->FavCategories->postAction(Action::Create, array(
            'category_id' => $this->categoryId,
            'category_type' => 'invalid',
        ));
    }
}
