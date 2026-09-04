<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Elabftw\App;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Interfaces\ControllerInterface;
use Elabftw\Services\LabCollector\LabCollectorClient;
use Override;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Small JSON endpoint backing the "LabCollector Link" helper in the entity
 * editor: given a module and record id, look up its real name and storage
 * location so the inserted link/field is more than a bare id.
 */
final class LabCollectorLookupController implements ControllerInterface
{
    public function __construct(private App $app) {}

    #[Override]
    public function getResponse(): Response
    {
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }
        $module = $this->app->Request->query->getString('module');
        $id = $this->app->Request->query->getString('id');
        if ($module === '' || $id === '') {
            throw new ImproperActionException('Missing module or id.');
        }

        $LabCollector = new LabCollectorClient($this->app->Teams->teamArr);
        try {
            $summary = $LabCollector->getSummary($module, $id);
        } catch (Throwable $e) {
            return new JsonResponse(array('error' => $e->getMessage()), Response::HTTP_BAD_REQUEST);
        }

        return new JsonResponse($summary);
    }
}
