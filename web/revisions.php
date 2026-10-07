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
use Elabftw\Models\TemplateVersions;
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

    // Templates: this page shows the permanent snapshots created by
    // "Publish new version" (custom_template_versions), not the ordinary
    // upstream auto-saved revisions -- those are two unrelated systems, and
    // publishing a version never touched the revisions table, so this page
    // used to never reflect what was actually published. Optional human
    // documentation per version still lives in the entity metadata so it's
    // exported/backed up with the template and requires no schema fork.
    $isTemplate = in_array($Entity->entityType, array(EntityType::Templates, EntityType::ItemsTypes), true);
    $RevisionsModel = new Revisions(
        $Entity,
        (int) $App->Config->configArr['max_revisions'],
        (int) $App->Config->configArr['min_delta_revisions'],
        (int) $App->Config->configArr['min_days_revisions'],
    );
    $revisionsArr = $isTemplate
        ? TemplateVersions::readAllForEntity($Entity->id ?? 0)
        : $RevisionsModel->readAll();
    // Each published version's own changelog: the ordinary auto-saved
    // revisions made while it was being worked on, so "what actually
    // changed within this version" is visible, not just the one before/
    // after snapshot the version itself is. See bucketRevisionsByVersion's
    // own comment for how a revision is assigned to a version.
    $versionRevisions = $isTemplate
        ? TemplateVersions::bucketRevisionsByVersion($revisionsArr, $RevisionsModel->readAll())
        : array();
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
        'versionRevisions' => $versionRevisions,
        'hideTitle' => $App->Request->query->getBoolean('embed'),
        // Set when this page is loaded inside the "Version history" popup's
        // own iframe (see view-edit-toolbar.html) -- that popup already has
        // its own close button and is itself inside the entity's own edit
        // page, so the site chrome (navbar, side panels, footer, Go back)
        // this page normally renders would just be a second, redundant copy
        // of the one already surrounding the popup.
        'embed' => $App->Request->query->getBoolean('embed'),
    );

    $Response->setContent($App->render($template, $renderArr));
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
