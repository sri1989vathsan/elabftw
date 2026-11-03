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
use PDO;
use Throwable;

use function ceil;
use function count;
use function file_get_contents;
use function fclose;
use function floor;
use function fwrite;
use function hash_equals;
use function header;
use function http_response_code;
use function implode;
use function is_array;
use function json_decode;
use function json_encode;
use function max;
use function min;
use function preg_replace_callback;
use function round;
use function sprintf;
use function str_replace;
use function stream_socket_client;
use function trim;

/**
 * Prints the label of an entry of the database on the Zebra label printer of the lab: the label is made in ZPL (the language of the
 * printer) and sent to the printer on the network, port 9100. The size of the label, the lines of each module and the address of
 * the printer are in label-config.json.
 *
 * POST {id, copies, dry}: dry gives the ZPL without printing it.
 */
require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
$config = json_decode((string) file_get_contents(__DIR__ . '/label-config.json'), true);
if (!is_array($config)) {
    respond(500, array('error' => 'label-config.json is not valid.'));
}

try {
    $id = (int) ($payload['id'] ?? 0);
    $copies = max(1, min(100, (int) ($payload['copies'] ?? 1)));
    // whoever can read the entry can print its label
    $data = new Inventory($App->Users, $id)->readOne();
    $pdo = Db::getConnection();
    $req = $pdo->prepare('SELECT title FROM inventory_categories WHERE id = :id');
    $req->bindValue(':id', (int) ($data['category'] ?? 0), PDO::PARAM_INT);
    $pdo->execute($req);
    $module = (string) $req->fetchColumn();

    $fields = array();
    $metadata = json_decode((string) ($data['metadata'] ?? ''), true);
    foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
        if (is_array($field)) {
            $fields[(string) $name] = trim((string) ($field['value'] ?? ''));
        }
    }
    $labelId = $data['custom_id'] !== null ? '#' . $data['custom_id'] : '';
    $mine = $data['personal_id'] !== null ? 'my ' . $data['personal_id'] : '';
    $values = array(
        'id' => $labelId,
        'my_id' => $mine,
        'id_line' => trim($labelId . ' ' . $mine),
        'title' => (string) ($data['title'] ?? ''),
        'module' => $module,
        'date' => (string) ($data['date'] ?? ''),
    );
    $design = ($config['modules'][$module] ?? array()) + ($config['default'] ?? array());
    $lines = array();
    foreach ($design['lines'] ?? array() as $template) {
        // a line is left out when one of its fields is empty
        $empty = false;
        $line = trim(preg_replace_callback('/\{(field:)?([^}]+)\}/', static function (array $m) use ($values, $fields, &$empty): string {
            $value = $m[1] === 'field:' ? ($fields[$m[2]] ?? '') : ($values[$m[2]] ?? '');
            $empty = $empty || $value === '';
            return $value;
        }, (string) $template));
        if ($line !== '' && !$empty) {
            $lines[] = $line;
        }
    }

    $dpi = (int) ($config['dpi'] ?? 300);
    $dots = static fn(float $mm): int => (int) round($mm * $dpi / 25.4);
    $width = $dots((float) $design['width_mm']);
    $height = $dots((float) $design['height_mm']);
    $margin = $dots((float) $design['margin_mm']);
    $qrSize = !empty($design['qr']) ? $height - 2 * $margin : 0;
    $textWidth = $width - 2 * $margin - ($qrSize > 0 ? $qrSize + $margin : 0);
    $count = max(1, count($lines));
    $font = (int) min($dots((float) $design['font_mm']), floor(($height - 2 * $margin) / $count * 0.9));
    $clean = static fn(string $text): string => str_replace(array('^', '~', '\\'), ' ', $text);

    $zpl = array('^XA', '^CI28', '^PW' . $width, '^LL' . $height, '^LH0,0');
    $y = $margin;
    foreach ($lines as $index => $line) {
        // the first line (the numbers) is bold: written twice, one dot apart
        $zpl[] = sprintf('^FO%d,%d^A0N,%d,%d^FB%d,1,0,L,0^FD%s^FS', $margin, $y, $font, $font, $textWidth, $clean($line));
        if ($index === 0) {
            $zpl[] = sprintf('^FO%d,%d^A0N,%d,%d^FB%d,1,0,L,0^FD%s^FS', $margin + 1, $y, $font, $font, $textWidth, $clean($line));
        }
        $y += (int) ceil($font * 1.1);
    }
    if ($qrSize > 0) {
        $base = (string) ($config['qr_base_url'] ?? '');
        if ($base === '') {
            $base = (($_SERVER['HTTPS'] ?? '') !== '' ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
        }
        $url = $base . '/registry.php?mode=view&id=' . $id;
        $magnification = max(2, (int) floor($qrSize / 37));
        $zpl[] = sprintf('^FO%d,%d^BQN,2,%d^FDQA,%s^FS', $width - $margin - $qrSize, $margin, $magnification, $url);
    }
    $zpl[] = '^PQ' . $copies;
    $zpl[] = '^XZ';
    $label = implode("\n", $zpl) . "\n";

    if (!empty($payload['dry'])) {
        respond(200, array('zpl' => $label, 'lines' => $lines, 'width_mm' => $design['width_mm'], 'height_mm' => $design['height_mm']));
    }
    $host = (string) ($config['printer']['host'] ?? '');
    if ($host === '') {
        respond(400, array('error' => 'The address of the printer is not set: put it in label-config.json (printer.host).'));
    }
    $socket = @stream_socket_client('tcp://' . $host . ':' . (int) ($config['printer']['port'] ?? 9100), $errno, $errstr, 5);
    if ($socket === false) {
        respond(502, array('error' => 'The printer at ' . $host . ' does not answer (' . $errstr . ').'));
    }
    fwrite($socket, $label);
    fclose($socket);
    respond(200, array('ok' => true, 'printed' => $copies, 'lines' => $lines));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage() !== '' ? $e->getMessage() : $e::class));
}
