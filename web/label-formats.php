<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\AppException;
use Elabftw\Exceptions\IllegalActionException;
use Exception;
use Symfony\Component\HttpFoundation\Response;

/**
 * The label formats and the address of the label printer: for the admins of the team.
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    if (!$App->Users->isAdmin) {
        throw new IllegalActionException();
    }
    $Response->prepare($App->Request);
    $Response->setContent($App->render('label-formats.html', array(
        'pageTitle' => _('Label formats'),
    )));
    $Response->headers->set('Cache-Control', 'no-store');
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
