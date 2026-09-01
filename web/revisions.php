<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012, 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\EntityType;
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\AppException;
use Elabftw\Models\Revisions;
use Exception;
use Symfony\Component\HttpFoundation\Response;

use function _;
use function in_array;
use function is_array;
use function json_decode;

/**
 * Show history of body of experiment or db item
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    $Response->prepare($App->Request);
    $Entity = EntityType::from($App->Request->query->getString('type'))->toInstance($App->Users);
    $Entity->setId($App->Request->query->getInt('item_id'));
    $Entity->canOrExplode(AccessType::Read);

    $revisionsArr = new Revisions(
        $Entity,
        (int) $App->Config->configArr['max_revisions'],
        (int) $App->Config->configArr['min_delta_revisions'],
        (int) $App->Config->configArr['min_days_revisions'],
    )->readAll();

    // Templates use the ordinary, upstream revision records as their version
    // snapshots. Keep optional human documentation in the entity metadata so
    // it is exported/backed up with the template and requires no schema fork.
    $isTemplate = in_array($Entity->entityType, array(EntityType::Templates, EntityType::ItemsTypes), true);
    $templateVersionDocs = array();
    if ($isTemplate && !empty($Entity->entityData['metadata'])) {
        $metadata = json_decode((string) $Entity->entityData['metadata'], true);
        if (is_array($metadata)) {
            $docs = $metadata['elabftw']['template_version_docs'] ?? array();
            if (is_array($docs)) {
                $templateVersionDocs = $docs;
            }
        }
    }

    $template = 'revisions.html';
    $renderArr = array(
        'Entity' => $Entity,
        'pageTitle' => $isTemplate ? _('Template versions') : _('Revisions'),
        'revisionsArr' => $revisionsArr,
        'isTemplate' => $isTemplate,
        'templateVersionDocs' => $templateVersionDocs,
    );

    $Response->setContent($App->render($template, $renderArr));
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
