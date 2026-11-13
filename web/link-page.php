<?php

/**
 * Fork-only. The page behind a link of an order, read by the server when the server can reach the internet: GET ?url=<link> gives
 * {ok, url, title, text}. The text is the text of the page, one block (a row of a table, an item of a list) on a line, with the data that the
 * page gives to the search engines (a Product: name, brand, catalog number, description) written first. It is read in the browser by
 * order-to-database.js (readPageText) into the columns of an entry. Without internet the answer is {ok: false} after a few seconds.
 *
 * The requester has to be signed in. The server is not a way into the network of the lab: only http and https, only the ports 80 and 443, no
 * address of the host that is private, local or reserved (every address that the name gives is checked, the connection is made to the
 * address that was checked, and each redirect is checked again), no more than 3 redirects, 6 seconds, 2 MB.
 *
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use DOMDocument;
use DOMXPath;

use function array_merge;
use function curl_close;
use function curl_exec;
use function curl_getinfo;
use function curl_init;
use function curl_setopt_array;
use function dns_get_record;
use function filter_var;
use function gethostbynamel;
use function header;
use function http_response_code;
use function implode;
use function in_array;
use function is_array;
use function is_string;
use function json_decode;
use function json_encode;
use function libxml_clear_errors;
use function libxml_use_internal_errors;
use function mb_substr;
use function parse_url;
use function preg_replace;
use function preg_match;
use function str_contains;
use function strlen;
use function strtolower;
use function trim;

/**
 * The address of the host as it is checked: the host and the addresses to connect to, or null when the link cannot be used
 *
 * @return array{host: string, port: int, scheme: string, ips: list<string>}|null
 */
function safeTarget(string $url): ?array
{
    $parts = parse_url($url);
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
        return null;
    }
    $scheme = strtolower((string) $parts['scheme']);
    if (!in_array($scheme, array('http', 'https'), true) || isset($parts['user']) || isset($parts['pass'])) {
        return null;
    }
    $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    if (!in_array($port, array(80, 443), true)) {
        return null;
    }
    $host = strtolower((string) $parts['host']);
    // an address written as a number is checked as it is, a name by every address it gives
    $ips = array();
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        $ips[] = $host;
    } else {
        foreach (gethostbynamel($host) ?: array() as $ip) {
            $ips[] = $ip;
        }
        foreach (dns_get_record($host, DNS_AAAA) ?: array() as $record) {
            if (isset($record['ipv6'])) {
                $ips[] = (string) $record['ipv6'];
            }
        }
    }
    if ($ips === array()) {
        return null;
    }
    foreach ($ips as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return null;
        }
    }
    return array('host' => $host, 'port' => $port, 'scheme' => $scheme, 'ips' => $ips);
}

/**
 * One request to the checked address. Gives the status, the headers' location and the body (at most 2 MB), or null.
 *
 * @return array{status: int, location: string, body: string}|null
 */
function fetchOnce(string $url, array $target): ?array
{
    $handle = curl_init($url);
    if ($handle === false) {
        return null;
    }
    $body = '';
    $location = '';
    curl_setopt_array($handle, array(
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 6,
        // the connection goes to the address that was checked (the name cannot be answered with another address in between)
        CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':' . $target['ips'][0]),
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; lab-inventory-linkreader)',
        CURLOPT_HTTPHEADER => array('Accept: text/html,application/xhtml+xml', 'Accept-Language: en'),
        CURLOPT_ENCODING => '',
        CURLOPT_HEADERFUNCTION => static function ($curl, string $header) use (&$location): int {
            if (preg_match('/^location:\s*(\S+)/i', $header, $found) === 1) {
                $location = $found[1];
            }
            return strlen($header);
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
            $body .= $chunk;
            // more than 2 MB: the transfer is stopped
            return strlen($body) > 2097152 ? 0 : strlen($chunk);
        },
    ));
    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    return $status === 0 ? null : array('status' => $status, 'location' => $location, 'body' => $body);
}

/**
 * The text of an HTML page: the data of its Product first, then the visible text with a line for each block.
 *
 * @return array{title: string, text: string}
 */
function pageText(string $html): array
{
    $previous = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    $doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    $xpath = new DOMXPath($doc);
    $lines = array();
    // what the page tells the search engines: {"@type": "Product", name, sku, mpn, brand, description}
    $product = static function (mixed $value) use (&$product, &$lines): void {
        if (!is_array($value)) {
            return;
        }
        $type = $value['@type'] ?? '';
        $type = is_array($type) ? implode(',', $type) : (string) $type;
        if (str_contains($type, 'Product')) {
            $brand = $value['brand'] ?? '';
            $brand = is_array($brand) ? (string) ($brand['name'] ?? '') : (string) $brand;
            foreach (array('name' => 'Product name', 'sku' => 'Catalog number', 'mpn' => 'Catalog number', 'description' => '') as $key => $label) {
                if (isset($value[$key]) && is_string($value[$key]) && trim($value[$key]) !== '') {
                    $lines[] = ($label !== '' ? $label . ' ' : '') . trim($value[$key]);
                }
            }
            if ($brand !== '') {
                $lines[] = 'Supplier ' . $brand;
            }
        }
        foreach ($value as $inner) {
            $product($inner);
        }
    };
    foreach ($xpath->query('//script[@type="application/ld+json"]') ?: array() as $node) {
        $product(json_decode($node->textContent, true));
    }
    $titleNodes = $xpath->query('//title');
    $title = $titleNodes !== false && $titleNodes->length > 0 ? trim($titleNodes->item(0)?->textContent ?? '') : '';
    foreach ($xpath->query('//script|//style|//noscript|//svg|//template|//head') ?: array() as $node) {
        $node->parentNode?->removeChild($node);
    }
    // a block ends with a line, the cells of a row are side by side: the label and the value of a table stay on one line
    foreach ($xpath->query('//p|//div|//li|//tr|//h1|//h2|//h3|//h4|//h5|//h6|//dt|//dd|//section|//br|//ul|//ol|//table') ?: array() as $node) {
        $node->appendChild($doc->createTextNode("\n"));
    }
    foreach ($xpath->query('//td|//th') ?: array() as $node) {
        $node->appendChild($doc->createTextNode(' '));
    }
    $text = $doc->textContent;
    $text = preg_replace('/[ \t\x{00A0}]+/u', ' ', $text) ?? $text;
    $text = preg_replace('/\s*\n\s*/', "\n", $text) ?? $text;
    return array('title' => $title, 'text' => mb_substr(trim(implode("\n", array_merge($lines, array($text)))), 0, 60000));
}

if (!defined('LINK_PAGE_AS_LIBRARY')) {
    require_once __DIR__ . '/app/init.inc.php';
    header('Content-Type: application/json; charset=utf-8');
    if ($App->isAnonymous()) {
        http_response_code(401);
        echo json_encode(array('ok' => false, 'error' => 'Authentication required.'));
        exit;
    }
    $url = trim((string) ($_GET['url'] ?? ''));
    $answer = array('ok' => false, 'url' => $url, 'title' => '', 'text' => '');
    $current = $url;
    for ($hop = 0; $hop <= 3 && $current !== ''; $hop++) {
        $target = safeTarget($current);
        if ($target === null) {
            break;
        }
        $got = fetchOnce($current, $target);
        if ($got === null) {
            break;
        }
        if ($got['status'] >= 300 && $got['status'] < 400 && $got['location'] !== '') {
            // a redirect is checked again, like the first address; a relative one is made absolute
            $next = $got['location'];
            if (!preg_match('~^https?://~i', $next)) {
                $next = $target['scheme'] . '://' . $target['host'] . ($next[0] === '/' ? '' : '/') . $next;
            }
            $current = $next;
            continue;
        }
        if ($got['status'] === 200 && $got['body'] !== '') {
            $read = pageText($got['body']);
            $answer = array('ok' => $read['text'] !== '', 'url' => $current, 'title' => $read['title'], 'text' => $read['text']);
        }
        break;
    }
    echo json_encode($answer);
}
