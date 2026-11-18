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
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * The label formats and the address of the label printer are the Labels tab of the Admin panel: this old address leads there (admins only).
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    if (!$App->Users->isAdmin) {
        throw new IllegalActionException();
    }
    // the label settings are the Labels tab of the Admin panel; the old address leads there
    $Response = new RedirectResponse('admin.php?tab=10');
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
