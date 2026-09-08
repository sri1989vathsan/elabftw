<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Services;

use DOMDocument;
use DOMElement;
use DOMNode;
use Elabftw\Enums\BodyContentType;

use function checkdate;
use function count;
use function libxml_clear_errors;
use function libxml_use_internal_errors;
use function mb_strtolower;
use function preg_match;
use function preg_match_all;
use function preg_replace;
use function str_contains;
use function strlen;
use function strtolower;
use function trim;

/**
 * Extract a dated, hierarchy-aware heading index from an entity body.
 *
 * A heading inherits the closest preceding eLabFTW date reference. If no
 * explicit date reference precedes it, the entity date is used. This keeps the
 * activity calendar migration-free while allowing one document to contribute
 * headings to several calendar days.
 */
final class CalendarActivityHeadingExtractor
{
    public function extract(string $body, BodyContentType $contentType, string $fallbackDate): array
    {
        if (trim($body) === '') {
            return array();
        }
        return $contentType === BodyContentType::Markdown
            ? $this->extractMarkdown($body, $fallbackDate)
            : $this->extractHtml($body, $fallbackDate);
    }

    private function extractHtml(string $body, string $fallbackDate): array
    {
        $document = new DOMDocument('1.0', 'UTF-8');
        $previousErrorState = libxml_use_internal_errors(true);
        $loaded = $document->loadHTML(
            '<?xml encoding="utf-8" ?><div id="calendar-activity-root">' . $body . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD,
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previousErrorState);
        if ($loaded === false) {
            return array();
        }

        $root = $document->getElementById('calendar-activity-root');
        if (!$root instanceof DOMElement) {
            return array();
        }

        $headings = array();
        $parents = array();
        $currentDate = $fallbackDate;
        $headingIndex = 0;
        $this->walkHtml($root, $currentDate, $headingIndex, $headings, $parents);
        return $headings;
    }

    private function walkHtml(
        DOMNode $node,
        string &$currentDate,
        int &$headingIndex,
        array &$headings,
        array &$parents,
    ): void {
        foreach ($node->childNodes as $child) {
            if (!$child instanceof DOMElement) {
                continue;
            }
            $tag = strtolower($child->tagName);
            if (preg_match('/^h([1-6])$/D', $tag, $matches) === 1) {
                $ownDate = $this->findDateReference($child);
                if ($ownDate !== null) {
                    $currentDate = $ownDate;
                }
                $level = (int) $matches[1];
                $index = $headingIndex++;
                $text = trim((string) preg_replace('/\s+/u', ' ', $child->textContent));
                if ($text === '') {
                    continue;
                }
                while (!empty($parents) && $parents[count($parents) - 1]['level'] >= $level) {
                    array_pop($parents);
                }
                $parentIndex = empty($parents) ? null : $parents[count($parents) - 1]['index'];
                $entry = array(
                    'index' => $index,
                    'level' => $level,
                    'text' => $text,
                    'date' => $currentDate,
                    'parent_index' => $parentIndex,
                    'anchor' => trim($child->getAttribute('id')),
                    'search_text' => mb_strtolower($text),
                );
                $headings[] = $entry;
                $parents[] = array('level' => $level, 'index' => $index);
                // A date reference inside this heading was already handled.
                continue;
            }

            if ($tag === 'time' && $this->isDateReferenceTime($child)) {
                $date = $this->validDate($child->getAttribute('datetime'));
                if ($date !== null) {
                    $currentDate = $date;
                }
            }
            $this->walkHtml($child, $currentDate, $headingIndex, $headings, $parents);
        }
    }

    private function findDateReference(DOMElement $heading): ?string
    {
        foreach ($heading->getElementsByTagName('time') as $time) {
            if ($time instanceof DOMElement && $this->isDateReferenceTime($time)) {
                $date = $this->validDate($time->getAttribute('datetime'));
                if ($date !== null) {
                    return $date;
                }
            }
        }
        return null;
    }

    private function isDateReferenceTime(DOMElement $time): bool
    {
        $parent = $time->parentNode;
        while ($parent instanceof DOMElement) {
            $classes = ' ' . $parent->getAttribute('class') . ' ';
            if (str_contains($classes, ' elabftw-date-reference ')) {
                return true;
            }
            $parent = $parent->parentNode;
        }
        return false;
    }

    private function extractMarkdown(string $body, string $fallbackDate): array
    {
        preg_match_all('/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/mu', $body, $matches, PREG_SET_ORDER);
        $headings = array();
        $parents = array();
        foreach ($matches as $index => $match) {
            $level = strlen($match[1]);
            $text = trim($match[2]);
            if ($text === '') {
                continue;
            }
            while (!empty($parents) && $parents[count($parents) - 1]['level'] >= $level) {
                array_pop($parents);
            }
            $parentIndex = empty($parents) ? null : $parents[count($parents) - 1]['index'];
            $headings[] = array(
                'index' => $index,
                'level' => $level,
                'text' => $text,
                'date' => $fallbackDate,
                'parent_index' => $parentIndex,
                'anchor' => '',
                'search_text' => mb_strtolower($text),
            );
            $parents[] = array('level' => $level, 'index' => $index);
        }
        return $headings;
    }

    private function validDate(string $value): ?string
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $value, $matches) !== 1) {
            return null;
        }
        return checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1])
            ? $value
            : null;
    }
}
