<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Controllers\AnimalStudiesController;
use Elabftw\Exceptions\AppException;
use Exception;
use Symfony\Component\HttpFoundation\Response;

require_once 'app/init.inc.php';

$Response = new Response();
try {
    $Response = new AnimalStudiesController($App)->getResponse();
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
