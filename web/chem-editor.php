<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2024 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Controllers\ChemEditorController;
use Elabftw\Exceptions\AppException;
use Exception;
use Symfony\Component\HttpFoundation\Response;

/**
 * Chemistry editor
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    // a tool that an admin switched off for the team: a short message (admins can still open it by its address)
    if (!$App->Users->isAdmin && (int) ($App->Teams->teamArr['tools_chem_editor'] ?? 1) !== 1) {
        throw new \Elabftw\Exceptions\ImproperActionException(_('The Chemical Structure Editor is switched off by your admin.'));
    }
    $Response = new ChemEditorController($App)->getResponse();
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    // autologout if there is elabid in view mode
    // so we don't stay logged in as anon
    if ($App->Request->query->has('elabid')
        && $App->Request->query->get('mode') === 'view'
        && !$App->Request->getSession()->has('is_auth')) {
        $App->Session->invalidate();
    }
    $Response->send();
}
