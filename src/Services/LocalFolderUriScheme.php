<?php

/**
 * @author Srivathsan Adivarahan <srivathsan.adivarahan@gmail.com>
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services;

use HTMLPurifier_URIScheme;

/**
 * Restrict local-folder helper links to an action and opaque identifier.
 */
final class LocalFolderUriScheme extends HTMLPurifier_URIScheme
{
    /** @var bool */
    public $hierarchical = true;

    /**
     * @param \HTMLPurifier_URI $uri
     * @param \HTMLPurifier_Config $config
     * @param \HTMLPurifier_Context $context
     */
    public function doValidate(&$uri, $config, $context): bool
    {
        if ($uri->userinfo !== null || $uri->port !== null || $uri->query !== null || $uri->fragment !== null) {
            return false;
        }
        if ($uri->host !== 'open' && $uri->host !== 'register') {
            return false;
        }
        return preg_match('/^\/[A-Za-z0-9-]{1,80}$/D', $uri->path) === 1;
    }
}
