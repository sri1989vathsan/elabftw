<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Exceptions\UnauthorizedException;
use Override;

use function _;
use function array_merge;
use function file_get_contents;
use function is_array;
use function json_decode;
use function usort;

use const JSON_THROW_ON_ERROR;

/**
 * Lists the newest features of this installation. Entries live in
 * src/whats-new.json (newest first once sorted) so they can be edited
 * without touching code.
 */
final class WhatsNewController extends AbstractHtmlController
{
    private const string ENTRIES_FILE = __DIR__ . '/../whats-new.json';

    #[Override]
    protected function getTemplate(): string
    {
        return 'whats-new.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('What\'s new');
    }

    #[Override]
    protected function getData(): array
    {
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }

        // The template draws its own heading (with an icon); hide the base one.
        return array_merge(parent::getData(), array('hideTitle' => true, 'whatsNewEntries' => $this->getEntries()));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function getEntries(): array
    {
        $json = file_get_contents(self::ENTRIES_FILE);
        if ($json === false) {
            return array();
        }
        $entries = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($entries)) {
            return array();
        }
        usort($entries, static fn(array $a, array $b): int => ($b['date'] ?? '') <=> ($a['date'] ?? ''));

        return $entries;
    }
}
