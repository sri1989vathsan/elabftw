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

use Elabftw\Models\Inventory;
use RuntimeException;
use Throwable;

use function count;
use function file_get_contents;
use function hash_equals;
use function header;
use function http_response_code;
use function is_array;
use function is_string;
use function json_decode;
use function json_encode;
use function strlen;

/**
 * The alignment of sequencing reads to the reference sequence of an entry of the database, done on the server.
 * Needs a login, the right to read the entry and the token of the page; answers json.
 */
require_once dirname(__DIR__) . '/app/init.inc.php';
require_once __DIR__ . '/aligner.inc.php';
require_once __DIR__ . '/aligner-external.inc.php';

const MAX_READS = 40;
const MAX_REFERENCE = 500000;
const MAX_READ = 30000;

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'Use POST.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
try {
    $entryId = (int) ($payload['entry'] ?? 0);
    $Entity = new Inventory($App->Users, $entryId > 0 ? $entryId : null);
    $Entity->readOne();
} catch (Throwable) {
    respond(403, array('error' => 'You cannot open this entry.'));
}
$reference = $payload['reference'] ?? null;
$reads = $payload['reads'] ?? null;
if (!is_string($reference) || strlen($reference) > MAX_REFERENCE || !is_array($reads) || count($reads) > MAX_READS) {
    respond(400, array('error' => 'Invalid reference or reads.'));
}

// the algorithm of the alignment: the built-in one (default), MAFFT or Clustal Omega
$engine = ExternalAligner::normalize($payload['algorithm'] ?? null);
if ($engine === null) {
    respond(400, array('error' => 'Unknown algorithm.'));
}
if (!ExternalAligner::isAvailable($engine)) {
    respond(503, array('error' => ExternalAligner::label($engine) . ' is not installed on this server.'));
}

$results = array();
foreach ($reads as $read) {
    $sequence = is_array($read) ? ($read['sequence'] ?? null) : null;
    $name = is_array($read) ? (string) ($read['name'] ?? '') : '';
    if (!is_string($sequence) || strlen($sequence) > MAX_READ) {
        respond(400, array('error' => 'Invalid read.'));
    }
    try {
        $alignment = SequenceAligner::align($reference, $sequence, $engine);
    } catch (RuntimeException $e) {
        respond(500, array('error' => $e->getMessage()));
    }
    $results[] = array('name' => $name, 'found' => $alignment !== null, 'alignment' => $alignment);
}
respond(200, array('algorithm' => $engine, 'label' => ExternalAligner::label($engine), 'results' => $results));
