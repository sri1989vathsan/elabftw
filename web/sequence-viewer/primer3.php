<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use RuntimeException;

use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function json_decode;
use function json_encode;
use function strtoupper;

/**
 * Primer design with Primer3 on the server. Needs a login and the token of the page; answers json.
 * GET answers whether Primer3 is installed; POST {sequence, start, end, options} designs primer pairs for the region.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';
require_once __DIR__ . '/primer3.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    respond(200, array('available' => Primer3::binary() !== null));
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'Use GET or POST.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload) || !isset($payload['sequence'])) {
    respond(400, array('error' => 'Invalid request.'));
}
$options = is_array($payload['options'] ?? null) ? $payload['options'] : array();
try {
    $input = Primer3::input(strtoupper((string) $payload['sequence']), (int) ($payload['start'] ?? 0), (int) ($payload['end'] ?? 0), $options);
    respond(200, Primer3::pairs(Primer3::run($input), $options));
} catch (RuntimeException $e) {
    respond(422, array('error' => $e->getMessage()));
}
