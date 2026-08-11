<?php

/**
 * @author Andreas Moor
 * @copyright 2026 Andreas Moor
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\AppException;
use Elabftw\Exceptions\IllegalActionException;
use Exception;
use PDO;
use Symfony\Component\HttpFoundation\Response;

/**
 * Lab Logs dashboard — shows all YYYYMM-log resources across team members
 * Accessible only to team admins
 */
require_once 'app/init.inc.php';

$Response = new Response();

try {
    $Response->prepare($App->Request);
    if (!$App->Users->isAdmin) {
        throw new IllegalActionException('Non admin user tried to access lab logs dashboard.');
    }

    $team = $App->Users->userData['team'];

    // Query all resource items whose title matches the YYYYMM-log pattern, for the current team
    $Db = Db::getConnection();
    $sql = "SELECT
                items.id,
                items.title,
                items.userid,
                items.modified_at,
                items.created_at,
                CONCAT(users.firstname, ' ', users.lastname) AS fullname
            FROM items
            LEFT JOIN users ON items.userid = users.userid
            WHERE items.team = :team
                AND items.state = 1
                AND items.title REGEXP '^[0-9]{6}-log'
            ORDER BY users.lastname ASC, users.firstname ASC, items.title DESC";
    $req = $Db->prepare($sql);
    $req->bindParam(':team', $team, PDO::PARAM_INT);
    $req->execute();
    $allLogs = $req->fetchAll();

    // Group logs by user
    $logsByUser = array();
    foreach ($allLogs as $log) {
        $logsByUser[$log['fullname']][] = $log;
    }

    $template = 'lab-logs.html';
    $renderArr = array(
        'pageTitle' => _('Lab Logs'),
        'logsByUser' => $logsByUser,
    );

    $Response->setContent($App->render($template, $renderArr));
} catch (AppException $e) {
    $Response = $e->getResponseFromException($App);
} catch (Exception $e) {
    $Response = $App->getResponseFromException($e);
} finally {
    $Response->send();
}
