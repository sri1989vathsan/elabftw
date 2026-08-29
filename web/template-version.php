<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\AppException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Models\Templates;
use Exception;
use PDO;
use Symfony\Component\HttpFoundation\Response;

use function _;
use function sprintf;

/**
 * Read-only view of a single published template version, rendered the same
 * way as a normal template view page (see template-version-view.html).
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    $Response->prepare($App->Request);
    $versionId = $App->Request->query->getInt('id');

    $Db = Db::getConnection();
    $sql = 'SELECT v.id, v.entity_id, v.version, v.body, v.published_at,
                CONCAT(u.firstname, " ", u.lastname) AS published_by_fullname
            FROM custom_template_versions AS v
            LEFT JOIN users AS u ON u.userid = v.published_by
            WHERE v.id = :id';
    $req = $Db->prepare($sql);
    $req->bindParam(':id', $versionId, PDO::PARAM_INT);
    $req->execute();
    $version = $req->fetch(PDO::FETCH_ASSOC);
    if ($version === false) {
        throw new ResourceNotFoundException();
    }

    // Reuse the normal Templates permission model: whatever grants read
    // access to the live template also grants it to a past version of it.
    $Templates = new Templates($App->Users, (int) $version['entity_id']);
    $Templates->canOrExplode(AccessType::Read);
    $version['template_title'] = $Templates->entityData['title'];

    $template = 'template-version-view.html';
    $renderArr = array(
        'Entity' => $Templates,
        'pageTitle' => sprintf(_('%s — Version %d'), $version['template_title'], $version['version']),
        'version' => $version,
    );

    $Response->setContent($App->render($template, $renderArr));
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
