<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\AppException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\PyratLinks;
use Elabftw\Services\Pyrat\PyratAccess;
use Elabftw\Services\Pyrat\PyratClient;
use Exception;
use JsonException;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

use function array_map;
use function dirname;
use function is_array;
use function json_decode;

require_once dirname(__DIR__) . '/init.inc.php';

$Response = new JsonResponse();
try {
    if (!FeatureFlags::ANIMAL_STUDIES) {
        throw new ResourceNotFoundException();
    }
    if ($App->isAnonymous()) {
        throw new UnauthorizedException();
    }
    PyratAccess::assertAllowed($App->Users, $App->Config->configArr);
    $action = $App->Request->query->getString('action');
    $Pyrat = new PyratClient();
    $Links = new PyratLinks($App->Users);

    if ($App->Request->isMethod('GET')) {
        $data = match ($action) {
            'status' => $Pyrat->getStatus(),
            'animals' => $Pyrat->searchAnimals(array(
                'q' => $App->Request->query->getString('q'),
                'cage' => $App->Request->query->getString('cage'),
                'status' => $App->Request->query->getString('status'),
            )),
            'cages' => $Pyrat->searchCages(array('q' => $App->Request->query->getString('q'))),
            'experiment-links' => array_map(static fn(array $link): array => $link + array(
                'scoresheet_url' => $Pyrat->getScoresheetUrl(
                    (string) $link['entity_type'],
                    (string) $link['pyrat_entity_id'],
                ),
            ), $Links->readForExperiment($App->Request->query->getInt('experiment_id'))),
            default => throw new ImproperActionException('Unknown PyRAT action.'),
        };
        $Response->setData(array('ok' => true, 'data' => $data));
    } elseif ($App->Request->isMethod('POST')) {
        try {
            $body = json_decode($App->Request->getContent(), true, 16, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new ImproperActionException('Invalid JSON payload.', previous: $e);
        }
        if (!is_array($body)) {
            throw new ImproperActionException('Invalid JSON payload.');
        }
        $postAction = (string) ($body['action'] ?? $action);
        $data = match ($postAction) {
            'link' => (function () use ($Links, $Pyrat, $body): array {
                $entityType = (string) ($body['entity_type'] ?? '');
                $requestedId = (string) ($body['entity_id'] ?? '');
                $entity = match ($entityType) {
                    'animal' => $Pyrat->getAnimal($requestedId),
                    'cage' => $Pyrat->getCage($requestedId),
                    default => throw new ImproperActionException('PyRAT entity type must be animal or cage.'),
                };
                $entityId = (string) ($entity['id'] ?? '');
                $label = (string) ($entity[$entityType === 'animal' ? 'animal_id' : 'cage_id'] ?? $entityId);
                return array('id' => $Links->link(
                    (int) ($body['experiment_id'] ?? 0),
                    $entityType,
                    $entityId,
                    $label,
                ));
            })(),
            'unlink' => array('deleted' => $Links->unlink(
                (int) ($body['experiment_id'] ?? 0),
                (string) ($body['entity_type'] ?? ''),
                (string) ($body['entity_id'] ?? ''),
            )),
            'test' => (function () use ($App, $Pyrat): array {
                $App->Users->isSysadminOrExplode();
                return $Pyrat->getStatus();
            })(),
            default => throw new ImproperActionException('Unknown PyRAT action.'),
        };
        $Response->setData(array('ok' => true, 'data' => $data));
    } else {
        $Response->setStatusCode(Response::HTTP_METHOD_NOT_ALLOWED);
        $Response->setData(array('ok' => false, 'error' => 'Method not allowed.'));
    }
} catch (AppException $e) {
    $Response->setStatusCode($e->getCode() >= 400 && $e->getCode() < 600 ? $e->getCode() : Response::HTTP_BAD_REQUEST);
    $Response->setData(array('ok' => false, 'error' => $e->getMessage()));
} catch (Exception $e) {
    $App->Log->error('PyRAT integration error', array(array('exception' => $e)));
    $Response->setStatusCode(Response::HTTP_INTERNAL_SERVER_ERROR);
    $Response->setData(array('ok' => false, 'error' => 'PyRAT integration error.'));
} finally {
    $Response->send();
}
