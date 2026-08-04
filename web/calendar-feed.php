<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\CalendarFeed;
use Elabftw\Models\Config;
use Elabftw\Services\AccountCalendarFeed;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

use function dirname;

// Calendar providers cannot use an eLabFTW browser session, so this endpoint
// authenticates only with the long random account feed token.
require_once dirname(__DIR__) . '/vendor/autoload.php';

$Request = Request::createFromGlobals();
try {
    $Config = Config::getConfig();
    new SchemaVersionChecker((int) $Config->configArr['schema'])->checkSchema();
    $userid = CalendarFeed::getUseridFromToken($Request->query->getString('token'));
    $content = (new AccountCalendarFeed($userid, Env::asUrl('SITE_URL')))->render();
    $Response = new Response($content, Response::HTTP_OK, array(
        'Cache-Control' => 'private, no-store, max-age=0',
        'Content-Disposition' => 'inline; filename="elabftw-tasks.ics"',
        'Content-Type' => 'text/calendar; charset=utf-8',
        'Referrer-Policy' => 'no-referrer',
        'X-Content-Type-Options' => 'nosniff',
        'X-Robots-Tag' => 'noindex, nofollow',
    ));
} catch (UnauthorizedException) {
    $Response = new Response('Calendar feed not found.', Response::HTTP_NOT_FOUND);
} catch (Throwable) {
    $Response = new Response('Calendar feed is temporarily unavailable.', Response::HTTP_SERVICE_UNAVAILABLE);
}
$Response->prepare($Request)->send();
