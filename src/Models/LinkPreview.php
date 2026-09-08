<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;

use function fclose;
use function filter_var;
use function fopen;
use function fread;
use function gethostbynamel;
use function html_entity_decode;
use function in_array;
use function mb_substr;
use function parse_url;
use function preg_match;
use function preg_replace;
use function stream_context_create;
use function strlen;
use function trim;

use const ENT_HTML5;
use const ENT_QUOTES;
use const FILTER_FLAG_NO_PRIV_RANGE;
use const FILTER_FLAG_NO_RES_RANGE;
use const FILTER_VALIDATE_IP;

/**
 * Fetches a small, read-only preview (hostname + page title) for a pasted
 * link, so a rich-text field can show "Site: Title" instead of a bare URL.
 * No data is persisted here -- this is a stateless proxy fetch, so only
 * readAll() (called as GET api/v2/link_preview/?url=...) is meaningful;
 * everything else is explicitly unsupported.
 *
 * Security posture (this fetches a URL the requester supplies, so SSRF is
 * the primary risk):
 * - only plain http(s) URLs are accepted;
 * - the hostname is resolved and every resulting IP must be public
 *   (no loopback/private/link-local/reserved ranges), so an attacker can't
 *   point this at the instance's own internal network;
 * - the fetch follows no redirects at all -- a redirect to an internal
 *   address would otherwise bypass the hostname check above;
 * - a short timeout and a capped read size keep a slow or huge response
 *   from tying up a worker or exhausting memory;
 * - only a `<title>` tag is ever extracted via regex -- the response body
 *   is never parsed as HTML/executed/rendered.
 */
final class LinkPreview extends AbstractRest
{
    use SetIdTrait;

    private const int TIMEOUT_SECONDS = 5;

    private const int MAX_BYTES = 262_144;

    public function __construct(private Users $requester)
    {
        parent::__construct();
        $this->setId(null);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/link_preview/';
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $url = trim($queryParams->getQuery()->getString('url'));
        $hostname = $this->assertFetchableUrl($url);
        return array(
            'hostname' => $hostname,
            'title' => $this->fetchTitle($url),
        );
    }

    #[Override]
    public function readOne(): array
    {
        throw new ImproperActionException('This endpoint only supports GET with a url query parameter.');
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        throw new ImproperActionException('This endpoint only supports GET with a url query parameter.');
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        throw new ImproperActionException('This endpoint only supports GET with a url query parameter.');
    }

    #[Override]
    public function destroy(): bool
    {
        throw new ImproperActionException('This endpoint only supports GET with a url query parameter.');
    }

    /** @return string the validated URL's hostname */
    private function assertFetchableUrl(string $url): string
    {
        $parts = parse_url($url);
        if (
            $parts === false
            || !isset($parts['scheme'], $parts['host'])
            || !in_array($parts['scheme'], array('http', 'https'), true)
        ) {
            throw new ImproperActionException('Enter a valid http(s) URL.');
        }
        $host = $parts['host'];
        $ips = gethostbynamel($host);
        if ($ips === false || $ips === array()) {
            throw new ImproperActionException('Could not resolve that URL\'s host.');
        }
        foreach ($ips as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                throw new ImproperActionException('That URL cannot be fetched.');
            }
        }
        return $host;
    }

    private function fetchTitle(string $url): ?string
    {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'GET',
                'timeout' => self::TIMEOUT_SECONDS,
                'follow_location' => 0,
                'header' => "User-Agent: elabftw-link-preview\r\n",
                'ignore_errors' => true,
            ),
            'ssl' => array(
                'verify_peer' => true,
                'verify_peer_name' => true,
            ),
        ));
        $stream = @fopen($url, 'rb', false, $context);
        if ($stream === false) {
            return null;
        }
        // fread() over a network stream can (and often does) return fewer
        // bytes than asked for in one call -- read in a loop up to the cap
        // instead of assuming a single call fills the buffer
        $buffer = '';
        try {
            while (!feof($stream) && strlen($buffer) < self::MAX_BYTES) {
                $chunk = fread($stream, self::MAX_BYTES - strlen($buffer));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                $buffer .= $chunk;
            }
        } finally {
            fclose($stream);
        }
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $buffer, $matches) !== 1) {
            return null;
        }
        $title = html_entity_decode(trim((string) preg_replace('/\s+/', ' ', $matches[1])), ENT_QUOTES | ENT_HTML5);
        return $title === '' ? null : mb_substr($title, 0, 300);
    }
}
