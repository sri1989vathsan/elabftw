<?php

/**
 * @author eLabFTW contributors
 * @copyright 2026 eLabFTW contributors
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\AppException;
use Exception;
use Symfony\Component\HttpFoundation\Response;

/**
 * Team-scoped "please order this" board.
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    $Response->prepare($App->Request);
    $Response->setContent($App->render('orders.html', array(
        'pageTitle' => _('Orders'),
        'hideTitle' => true,
    )));
    $Response->headers->set('Cache-Control', 'no-store');
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
