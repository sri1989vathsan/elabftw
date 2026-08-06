<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Models\HtmlTools;
use League\Flysystem\UnableToReadFile;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Override;

use function fclose;
use function fopen;
use function pathinfo;
use function stream_copy_to_stream;
use function strtolower;
use function str_starts_with;

/** Serve one file from an enabled, sysadmin-installed HTML tool package. */
final class HtmlToolController extends AbstractController
{
    private const array CONTENT_TYPES = array(
        'css' => 'text/css; charset=utf-8',
        'csv' => 'text/csv; charset=utf-8',
        'gif' => 'image/gif',
        'htm' => 'text/html; charset=utf-8',
        'html' => 'text/html; charset=utf-8',
        'ico' => 'image/x-icon',
        'jpeg' => 'image/jpeg',
        'jpg' => 'image/jpeg',
        'js' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'map' => 'application/json; charset=utf-8',
        'mjs' => 'text/javascript; charset=utf-8',
        'otf' => 'font/otf',
        'pdf' => 'application/pdf',
        'png' => 'image/png',
        'svg' => 'image/svg+xml',
        'tsv' => 'text/tab-separated-values; charset=utf-8',
        'ttf' => 'font/ttf',
        'txt' => 'text/plain; charset=utf-8',
        'wasm' => 'application/wasm',
        'webp' => 'image/webp',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'xml' => 'application/xml; charset=utf-8',
    );

    #[Override]
    public function getResponse(): Response
    {
        // The controller must only be reached through the dedicated nginx
        // route, which supplies the restrictive tool CSP and sandbox headers.
        if (!str_starts_with($this->Request->getPathInfo(), '/html-tools/')) {
            throw new IllegalActionException('HTML tools can only be opened through the sandboxed tool route.');
        }

        $toolId = $this->Request->query->getInt('tool_id');
        $assetPath = $this->Request->query->getString('tool_path');
        $Tools = new HtmlTools($this->requester, $toolId);
        $tool = $Tools->readOne();
        if ((int) $tool['enabled'] !== 1 && !$this->requester->isSysadmin()) {
            throw new ResourceNotFoundException();
        }
        $storagePath = $Tools->getAssetStoragePath($assetPath);
        $filesystem = $Tools->getFilesystem();
        if (!$filesystem->fileExists($storagePath)) {
            throw new ResourceNotFoundException();
        }

        $Response = new StreamedResponse(static function () use ($filesystem, $storagePath): void {
            $output = fopen('php://output', 'wb');
            if ($output === false) {
                return;
            }
            try {
                $input = $filesystem->readStream($storagePath);
                stream_copy_to_stream($input, $output);
                fclose($input);
            } catch (UnableToReadFile) {
            } finally {
                fclose($output);
            }
        });
        $extension = strtolower(pathinfo($assetPath, PATHINFO_EXTENSION));
        $Response->headers->set('Content-Type', self::CONTENT_TYPES[$extension] ?? 'application/octet-stream');
        $Response->headers->set('Content-Disposition', 'inline');
        $Response->headers->set('Cache-Control', 'private, max-age=3600, no-transform');
        $Response->headers->set('X-Content-Type-Options', 'nosniff');
        return $Response;
    }
}
