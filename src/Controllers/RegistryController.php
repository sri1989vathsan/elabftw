<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Elabftw\App;
use Elabftw\Models\Inventory;
use Elabftw\Models\InventoryCategories;
use Symfony\Component\HttpFoundation\InputBag;
use Override;

use function _;

/**
 * For registry.php
 */
final class RegistryController extends AbstractEntityController
{
    public function __construct(App $app, Inventory $entity)
    {
        parent::__construct($app, $entity);

        $Categories = new InventoryCategories($app->Teams);
        $this->categoryArr = $Categories->readAll($Categories->getQueryParams(new InputBag(array('limit' => 9999))));
        $this->statusArr = $this->itemsStatusArr;
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Database');
    }

    #[Override]
    protected function getEntityProcurementRequestsArr(): array
    {
        return array();
    }
}
