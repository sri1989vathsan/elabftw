<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Controllers\HtmlToolController;
use Elabftw\Exceptions\AppException;
use Exception;

use function dirname;

require_once dirname(__DIR__) . '/init.inc.php';

try {
    $Response = new HtmlToolController($App->Users, $App->Request)->getResponse();
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
}
$Response->prepare($App->Request);
$Response->send();
