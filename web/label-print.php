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

use function array_filter;
use function array_map;
use function array_slice;
use function array_values;
use function in_array;
use function ceil;
use function explode;
use function mb_substr;
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
 * printer) and sent to the printer on the network, port 9100. The label formats (a size, a margin, a text size, a QR code, the lines)
 * and the address of the printer are set by an admin (label-formats.php); label-config.json holds what is used until then.
 *
 * GET ?formats=1 gives the formats and whether the printer is set; GET ?admin=1 gives all the settings (admins).
 * POST {id, copies, custom, format, dry} prints (dry gives the ZPL without printing it).
 * POST {action: save_format|delete_format|save_settings} is for admins.
 */
require_once __DIR__ . '/app/init.inc.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

$config = json_decode((string) file_get_contents(__DIR__ . '/label-config.json'), true);
if (!is_array($config)) {
    respond(500, array('error' => 'label-config.json is not valid.'));
}
$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$isAdmin = (bool) $App->Users->isAdmin;

// the formats of the team; until an admin has made one, the default of label-config.json is the only format
$loadFormats = static function () use ($pdo, $teamId, $config): array {
    $req = $pdo->prepare('SELECT id, name, width_mm, height_mm, margin_mm, margin_left_mm, margin_top_mm, margin_right_mm, margin_bottom_mm, offset_x_mm, offset_y_mm, rotate_180, font_mm, qr, `lines`, is_default FROM registry_label_formats WHERE team = :team ORDER BY is_default DESC, name');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $formats = array();
    foreach ($req->fetchAll() as $row) {
        $row['lines'] = json_decode((string) $row['lines'], true) ?: array('{id_line}', '{title}');
        $formats[] = $row;
    }
    if ($formats === array()) {
        $default = $config['default'];
        $formats[] = array('id' => 0, 'name' => $default['width_mm'] . ' x ' . $default['height_mm'] . ' mm', 'width_mm' => $default['width_mm'], 'height_mm' => $default['height_mm'], 'margin_mm' => 1.0, 'margin_left_mm' => $default['margin_left_mm'], 'margin_top_mm' => $default['margin_top_mm'], 'margin_right_mm' => $default['margin_right_mm'], 'margin_bottom_mm' => $default['margin_bottom_mm'], 'offset_x_mm' => $default['offset_x_mm'] ?? 0, 'offset_y_mm' => $default['offset_y_mm'] ?? 0, 'rotate_180' => !empty($default['rotate_180']) ? 1 : 0, 'font_mm' => $default['font_mm'], 'qr' => $default['qr'] ? 1 : 0, 'lines' => $default['lines'], 'is_default' => 1);
    }
    return $formats;
};
$loadSettings = static function () use ($pdo, $teamId, $config): array {
    $req = $pdo->prepare('SELECT printer_host, printer_port, dpi, qr_base_url FROM registry_label_settings WHERE team = :team');
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $row = $req->fetch();
    return is_array($row) ? $row : array('printer_host' => (string) ($config['printer']['host'] ?? ''), 'printer_port' => (int) ($config['printer']['port'] ?? 9100), 'dpi' => (int) ($config['dpi'] ?? 300), 'qr_base_url' => (string) ($config['qr_base_url'] ?? ''));
};

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $settings = $loadSettings();
    if (isset($_GET['admin'])) {
        if (!$isAdmin) {
            respond(403, array('error' => 'Only an admin can see the label settings.'));
        }
        respond(200, array('formats' => $loadFormats(), 'settings' => $settings));
    }
    respond(200, array('formats' => array_map(static fn(array $f): array => array('id' => (int) $f['id'], 'name' => $f['name'], 'width_mm' => $f['width_mm'], 'height_mm' => $f['height_mm'], 'is_default' => (int) $f['is_default']), $loadFormats()), 'printer_set' => $settings['printer_host'] !== ''));
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, array('error' => 'GET or POST only.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}

// the settings are for admins
$action = (string) ($payload['action'] ?? '');
if ($action !== '') {
    if (!$isAdmin) {
        respond(403, array('error' => 'Only an admin can change the label settings.'));
    }
    try {
        if ($action === 'save_margins') {
            $req = $pdo->prepare('UPDATE registry_label_formats SET margin_left_mm = :left, margin_top_mm = :top, margin_right_mm = :right, margin_bottom_mm = :bottom WHERE id = :id AND team = :team');
            foreach (array('left', 'top', 'right', 'bottom') as $side) {
                $req->bindValue(':' . $side, max(-10.0, min(10.0, (float) ($payload['margins'][$side] ?? 0))));
            }
            $req->bindValue(':id', (int) ($payload['id'] ?? 0), PDO::PARAM_INT);
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($req);
            respond(200, array('ok' => true));
        }
        if ($action === 'save_format') {
            // a margin of a side: empty means the margin of the format
            $sideValue = static fn(array $p, string $key): ?float => isset($p[$key]) && $p[$key] !== '' ? max(-10.0, min(10.0, (float) $p[$key])) : null;
            $name = trim((string) ($payload['name'] ?? ''));
            $width = (float) ($payload['width_mm'] ?? 0);
            $height = (float) ($payload['height_mm'] ?? 0);
            if ($name === '' || $width < 10 || $width > 120 || $height < 5 || $height > 200) {
                respond(400, array('error' => 'A name, a width (10 to 120 mm) and a height (5 to 200 mm) are needed.'));
            }
            $lines = array_values(array_filter(array_map('trim', explode("\n", (string) ($payload['lines'] ?? ''))), static fn(string $l): bool => $l !== ''));
            $values = array(
                ':team' => $teamId, ':name' => mb_substr($name, 0, 100), ':width' => $width, ':height' => $height,
                ':margin' => max(-10, min(10, (float) ($payload['margin_mm'] ?? 1.5))), ':offx' => max(-40.0, min(40.0, (float) ($payload['offset_x_mm'] ?? 0))), ':offy' => max(-40.0, min(40.0, (float) ($payload['offset_y_mm'] ?? 0))), ':left' => $sideValue($payload, 'margin_left_mm'), ':top' => $sideValue($payload, 'margin_top_mm'), ':right' => $sideValue($payload, 'margin_right_mm'), ':bottom' => $sideValue($payload, 'margin_bottom_mm'), ':font' => max(1, min(20, (float) ($payload['font_mm'] ?? 3.2))),
                ':qr' => !empty($payload['qr']) ? 1 : 0, ':rotate' => !empty($payload['rotate_180']) ? 1 : 0, ':lines' => json_encode($lines === array() ? array('{id_line}', '{title}') : array_slice($lines, 0, 8)),
            );
            $formatId = (int) ($payload['id'] ?? 0);
            if ($formatId > 0) {
                $req = $pdo->prepare('UPDATE registry_label_formats SET name = :name, width_mm = :width, height_mm = :height, margin_mm = :margin, margin_left_mm = :left, margin_top_mm = :top, margin_right_mm = :right, margin_bottom_mm = :bottom, offset_x_mm = :offx, offset_y_mm = :offy, rotate_180 = :rotate, font_mm = :font, qr = :qr, `lines` = :lines WHERE id = :id AND team = :team');
                $req->bindValue(':id', $formatId, PDO::PARAM_INT);
            } else {
                $req = $pdo->prepare('INSERT INTO registry_label_formats (team, name, width_mm, height_mm, margin_mm, margin_left_mm, margin_top_mm, margin_right_mm, margin_bottom_mm, offset_x_mm, offset_y_mm, rotate_180, font_mm, qr, `lines`) VALUES (:team, :name, :width, :height, :margin, :left, :top, :right, :bottom, :offx, :offy, :rotate, :font, :qr, :lines)');
            }
            foreach ($values as $key => $value) {
                $req->bindValue($key, $value);
            }
            $pdo->execute($req);
            $formatId = $formatId > 0 ? $formatId : (int) $pdo->lastInsertId();
            // one format is the default
            $count = $pdo->prepare('SELECT COUNT(*) FROM registry_label_formats WHERE team = :team AND is_default = 1');
            $count->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($count);
            if (!empty($payload['is_default']) || (int) $count->fetchColumn() === 0) {
                $pdo->prepare('UPDATE registry_label_formats SET is_default = IF(id = ' . $formatId . ', 1, 0) WHERE team = ' . $teamId)->execute();
            }
            respond(200, array('ok' => true, 'id' => $formatId));
        }
        if ($action === 'delete_format') {
            $req = $pdo->prepare('DELETE FROM registry_label_formats WHERE id = :id AND team = :team');
            $req->bindValue(':id', (int) ($payload['id'] ?? 0), PDO::PARAM_INT);
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($req);
            respond(200, array('ok' => true));
        }
        if ($action === 'save_settings') {
            $req = $pdo->prepare('INSERT INTO registry_label_settings (team, printer_host, printer_port, dpi, qr_base_url) VALUES (:team, :host, :port, :dpi, :base) ON DUPLICATE KEY UPDATE printer_host = VALUES(printer_host), printer_port = VALUES(printer_port), dpi = VALUES(dpi), qr_base_url = VALUES(qr_base_url)');
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $req->bindValue(':host', mb_substr(trim((string) ($payload['printer_host'] ?? '')), 0, 255));
            $req->bindValue(':port', max(1, min(65535, (int) ($payload['printer_port'] ?? 9100))), PDO::PARAM_INT);
            $req->bindValue(':dpi', in_array((int) ($payload['dpi'] ?? 300), array(203, 300, 600), true) ? (int) $payload['dpi'] : 300, PDO::PARAM_INT);
            $req->bindValue(':base', mb_substr(trim((string) ($payload['qr_base_url'] ?? '')), 0, 255));
            $pdo->execute($req);
            respond(200, array('ok' => true));
        }
        respond(400, array('error' => 'Unknown action.'));
    } catch (Throwable $e) {
        respond(400, array('error' => $e->getMessage()));
    }
}

try {
    $id = (int) ($payload['id'] ?? 0);
    $copies = max(1, min(100, (int) ($payload['copies'] ?? 1)));
    // whoever can read the entry can print its label
    // an admin can print a sample label with the settings of the format being edited (label-formats.js): no entry is needed
    $sample = !empty($payload['sample']) && $isAdmin;
    $data = $sample
        ? array('custom_id' => '1374', 'personal_id' => null, 'title' => 'Title of the entry', 'category' => 0, 'metadata' => '', 'date' => '')
        : new Inventory($App->Users, $id)->readOne();
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
    // the numbers are written plain: {id} is the number of the lab, {my_id} the number of the owner, {id_line} the number of the lab, or the
    // number of the owner when the entry is not in the lab Database
    $labelId = $data['custom_id'] !== null ? (string) $data['custom_id'] : '';
    $mine = $data['personal_id'] !== null ? (string) $data['personal_id'] : '';
    $values = array(
        'id' => $labelId,
        'my_id' => $mine,
        'id_line' => $labelId !== '' ? $labelId : $mine,
        'title' => (string) ($data['title'] ?? ''),
        'module' => $module,
        'date' => (string) ($data['date'] ?? ''),
    );
    $settings = $loadSettings();
    $chosen = null;
    foreach ($loadFormats() as $format) {
        if ($chosen === null || (int) $format['id'] === (int) ($payload['format'] ?? -1) || ((int) ($payload['format'] ?? -1) < 0 && $format['is_default'])) {
            $chosen = $format;
        }
        if ((int) $format['id'] === (int) ($payload['format'] ?? -1)) {
            break;
        }
    }
    $design = array('width_mm' => $chosen['width_mm'], 'height_mm' => $chosen['height_mm'], 'margin_mm' => $chosen['margin_mm'], 'margin_left_mm' => $chosen['margin_left_mm'], 'margin_top_mm' => $chosen['margin_top_mm'], 'margin_right_mm' => $chosen['margin_right_mm'], 'margin_bottom_mm' => $chosen['margin_bottom_mm'], 'offset_x_mm' => $chosen['offset_x_mm'], 'offset_y_mm' => $chosen['offset_y_mm'], 'rotate_180' => $chosen['rotate_180'], 'font_mm' => $chosen['font_mm'], 'qr' => (bool) $chosen['qr'], 'rotate_180' => (int) $chosen['rotate_180'], 'lines' => $chosen['lines']);
    if ($sample && is_array($payload['design'] ?? null)) {
        $given = $payload['design'];
        $num = static fn(string $key, float $min, float $max, float $fallback): float => isset($given[$key]) && is_numeric($given[$key]) ? max($min, min($max, (float) $given[$key])) : $fallback;
        $design['width_mm'] = $num('width_mm', 10, 120, (float) $design['width_mm']);
        $design['height_mm'] = $num('height_mm', 5, 200, (float) $design['height_mm']);
        $design['margin_mm'] = $num('margin_mm', -10, 10, 1.5);
        foreach (array('left', 'top', 'right', 'bottom') as $side) {
            $design['margin_' . $side . '_mm'] = isset($given['margin_' . $side . '_mm']) && is_numeric($given['margin_' . $side . '_mm']) ? $num('margin_' . $side . '_mm', -10, 10, 0) : $design['margin_mm'];
        }
        $design['offset_x_mm'] = $num('offset_x_mm', -40, 40, 0);
        $design['offset_y_mm'] = $num('offset_y_mm', -40, 40, 0);
        $design['font_mm'] = $num('font_mm', 1, 20, 3.2);
        $design['qr'] = !empty($given['qr']);
        $design['rotate_180'] = !empty($given['rotate_180']) ? 1 : 0;
        $sampleLines = array_values(array_filter(array_map('trim', explode("\n", (string) ($given['lines'] ?? ''))), static fn(string $l): bool => $l !== ''));
        $design['lines'] = $sampleLines === array() ? array('{id_line}', '{title}') : array_slice($sampleLines, 0, 8);
    }
    // margins dragged in the print dialog count for this label only (mm); the format keeps its own until an admin saves them
    foreach (array('left', 'top', 'right', 'bottom') as $side) {
        if (isset($payload['margins'][$side]) && is_numeric($payload['margins'][$side])) {
            $design['margin_' . $side . '_mm'] = max(-10.0, min(10.0, (float) $payload['margins'][$side]));
        }
    }
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

    // the text typed in the print dialog goes below: one line each, a few at most
    foreach (array_slice(explode("\n", (string) ($payload['custom'] ?? '')), 0, 4) as $custom) {
        $custom = trim(mb_substr($custom, 0, 60));
        if ($custom !== '') {
            $lines[] = $custom;
        }
    }

    $dpi = (int) $settings['dpi'];
    $dots = static fn(float $mm): int => (int) round($mm * $dpi / 25.4);
    $width = $dots((float) $design['width_mm']);
    $height = $dots((float) $design['height_mm']);
    // each side has its margin; an empty one is the margin of the format
    $side = static fn(string $key): int => $dots((float) ($design[$key] ?? $design['margin_mm']));
    $left = $side('margin_left_mm');
    $top = $side('margin_top_mm');
    $right = $side('margin_right_mm');
    $bottom = $side('margin_bottom_mm');
    $usable = $height - $top - $bottom;
    // the offset moves everything right and down, as it is read; it can be negative
    $offX = $dots((float) ($design['offset_x_mm'] ?? 0));
    $offY = $dots((float) ($design['offset_y_mm'] ?? 0));
    $qrSize = !empty($design['qr']) ? $usable : 0;
    $textWidth = $width - $left - $right - ($qrSize > 0 ? $qrSize + $dots(1.0) : 0);
    $count = max(1, count($lines));
    $font = (int) min($dots((float) $design['font_mm']), floor($usable / $count * 0.9));
    $clean = static fn(string $text): string => str_replace(array('^', '~', '\\'), ' ', $text);

    // the printer setup the label software of the printer sends first (media tracking, thermal transfer, speed, darkness)
    $header = (string) ($config['zpl_header'] ?? '^XA~TA000~JSN^LT0^MNW^MTT^PON^PMN^LH0,0^JMA^PR4,4~SD15^JUS^LRN^CI0^XZ');
    $zpl = array($header, '^XA', '^MMT', '^CI28', '^PW' . $width, '^LL' . $height, '^LS0', '^LH0,0');
    $y = $top;
    // a test pattern instead of the label: a frame at the edge of the label, a frame at the margins and the size in dots, to see where
    // the printer puts things
    if (!empty($payload['test'])) {
        $lines = array();
        $qrSize = 0;
        $zpl[] = sprintf('^FO0,0^GB%d,%d,3^FS', $width, $height);
        $zpl[] = sprintf('^FO%d,%d^GB%d,%d,1^FS', max(0, $left), max(0, $top), max(1, $width - $left - $right), max(1, $height - $top - $bottom));
        $zpl[] = sprintf('^FO%d,%d^A0N,28,28^FD%dx%d^FS', max(0, $left + 8), max(0, $top + 8), $width, $height);
    }
    // each text is placed by its baseline, as the label software of the printer does; a label that is read turned by 180 degrees has
    // its texts written inverted from the opposite corner (^A0I), so the print is the same as the software makes
    $rotated = !empty($design['rotate_180']);
    // a text is broken after a space or a hyphen; a word longer than the room is cut
    $wrap = static function (string $text, int $chars, int $rows): array {
        $out = array();
        $current = '';
        foreach (preg_split('/(?<=[\s-])/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: array($text) as $piece) {
            if ($current !== '' && mb_strlen(rtrim($current . $piece)) > $chars) {
                $out[] = rtrim($current);
                $current = $piece;
            } else {
                $current .= $piece;
            }
        }
        $out[] = rtrim($current);
        return array_map(static fn(string $row): string => mb_substr($row, 0, $chars), array_slice($out, 0, $rows));
    };
    $charsAt = static fn(int $size): int => max(1, (int) floor($textWidth / ($size * 0.56)));
    // a text that does not fit in one row gets a smaller font and up to two rows, so that nothing is cut
    $small = max(8, (int) round($font * 0.75));
    $plan = array();
    foreach ($lines as $line) {
        if (mb_strlen($line) <= $charsAt($font)) {
            $plan[] = array('size' => $font, 'text' => $line);
            continue;
        }
        foreach ($wrap($line, $charsAt($small), 2) as $part) {
            $plan[] = array('size' => $small, 'text' => $part);
        }
    }
    // when the rows do not fit the height of the label, every font gets smaller by the same part
    $needed = 0;
    foreach ($plan as $item) {
        $needed += (int) ceil($item['size'] * 1.15);
    }
    $scale = $needed > $usable + (int) ($font * 0.3) ? max(0.5, $usable / $needed) : 1.0;
    $elements = array();
    $cursor = $top;
    foreach ($plan as $item) {
        $size = max(8, (int) floor($item['size'] * $scale));
        if ($cursor + $size > $height - $bottom + (int) ($font * 0.3)) {
            break;
        }
        $baseline = $cursor + (int) round($size * 0.8);
        $cursor += (int) ceil($size * 1.15);
        $readX = $left + $offX;
        $readY = $baseline + $offY;
        $x = max(0, $rotated ? $width - $readX : $readX);
        $y = max(0, $rotated ? $height - $readY : $readY);
        $zpl[] = sprintf('^FT%d,%d^A0%s,%d,%d^FH\^FD%s^FS', $x, $y, $rotated ? 'I' : 'N', $size, $size, $clean($item['text']));
        // the preview shows the label as it is on the stock: the offsets only make up for where the printer puts things, so it leaves them out
        $elements[] = array('type' => 'text', 'x' => $rotated ? $width - $left : $left, 'y' => $rotated ? $height - $baseline : $baseline, 'h' => $size, 'text' => $item['text'], 'inverted' => $rotated);
    }
    if ($qrSize > 0) {
        $base = (string) $settings['qr_base_url'];
        if ($base === '') {
            $base = (($_SERVER['HTTPS'] ?? '') !== '' ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
        }
        $url = $base . '/registry.php?mode=view&id=' . $id;
        $magnification = max(2, (int) floor($qrSize / 37));
        $readQrX = $width - $right - $qrSize + $offX;
        $readQrY = $top + $offY;
        $qrX = max(0, $rotated ? $width - $readQrX - $qrSize : $readQrX);
        $qrY = max(0, $rotated ? $height - $readQrY - $qrSize : $readQrY);
        $zpl[] = sprintf('^FO%d,%d^BQN,2,%d^FDQA,%s^FS', $qrX, $qrY, $magnification, $url);
        $previewQrX = $width - $right - $qrSize;
        $elements[] = array('type' => 'qr', 'x' => $rotated ? $width - $previewQrX - $qrSize : $previewQrX, 'y' => $rotated ? $height - $top - $qrSize : $top, 'size' => $qrSize);
    }
    $zpl[] = '^PQ' . $copies;
    $zpl[] = '^XZ';
    $label = implode("\n", $zpl) . "\n";

    if (!empty($payload['dry'])) {
        respond(200, array('zpl' => $label, 'elements' => $elements, 'margins' => array('left' => $left, 'top' => $top, 'right' => $right, 'bottom' => $bottom), 'width' => $width, 'height' => $height, 'rotated' => $rotated, 'lines' => $lines, 'width_mm' => $design['width_mm'], 'height_mm' => $design['height_mm']));
    }
    $host = (string) $settings['printer_host'];
    if ($host === '') {
        respond(400, array('error' => 'The address of the printer is not set: an admin sets it on the Label formats page.'));
    }
    $socket = @stream_socket_client('tcp://' . $host . ':' . (int) $settings['printer_port'], $errno, $errstr, 5);
    if ($socket === false) {
        respond(502, array('error' => 'The printer at ' . $host . ' does not answer (' . $errstr . ').'));
    }
    fwrite($socket, $label);
    fclose($socket);
    respond(200, array('ok' => true, 'printed' => $copies, 'lines' => $lines));
} catch (Throwable $e) {
    respond(400, array('error' => $e->getMessage() !== '' ? $e->getMessage() : $e::class));
}
