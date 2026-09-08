<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Services\LabCollector\LabCollectorClient;
use Override;

use function array_merge;
use function _;

final class LabCollectorController extends AbstractHtmlController
{
    #[Override]
    protected function getTemplate(): string
    {
        return 'labcollector.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('LabCollector');
    }

    #[Override]
    protected function getData(): array
    {
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }

        $LabCollector = new LabCollectorClient($this->app->Teams->teamArr);
        $status = $LabCollector->getStatus();
        $module = $this->app->Request->query->getString('module');
        $records = array();
        $modules = array();
        $error = '';

        try {
            if ($LabCollector->isConfigured()) {
                $modules = $LabCollector->listModules();
                if ($module !== '') {
                    $records = $LabCollector->searchRecords($module, array(
                        'q' => $this->app->Request->query->getString('q'),
                    ));
                }
            }
        } catch (\Throwable $e) {
            $error = $e->getMessage();
        }

        return array_merge(parent::getData(), array(
            'labCollectorStatus' => $status,
            'labCollectorModules' => $modules,
            'labCollectorModule' => $module,
            'labCollectorRecords' => $records,
            'labCollectorError' => $error,
        ));
    }
}
