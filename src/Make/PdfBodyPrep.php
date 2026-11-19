<?php

/**
 * Prepares the body of an entry for the PDF export: spreadsheets are drawn as the grid people see on screen (grid lines, grey
 * coordinate cells, fills, widths, no zebra stripes, no empty filler columns or rows) and, when asked, only the selected sections stay.
 *
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Make;

use Dom\Element;
use Dom\HTMLDocument;
use Dom\Node;
use Throwable;

use function array_filter;
use function array_map;
use function array_values;
use function count;
use function explode;
use function in_array;
use function round;
use function max;
use function preg_match;
use function preg_replace;
use function str_contains;
use function trim;

final class PdfBodyPrep
{
    private const string GRID_LINE = '1px solid #c8c8c8';

    /** The sections asked for in the request: "3,4,9" -> the positions (0 based) of the headings in the body, in document order. */
    public static function parseSections(string $raw): array
    {
        $parts = array_map('trim', explode(',', $raw));
        return array_values(array_filter(array_map('intval', array_filter($parts, static fn(string $part): bool => preg_match('/^\d{1,5}$/', $part) === 1))));
    }

    /**
     * Keeps the selected sections: a heading and what follows it up to the next heading, plus the headings above it that hold it.
     * $selected holds the positions of the chosen headings (1 based, in document order). Nothing selected leaves the body as it is.
     */
    public static function selectSections(string $html, array $selected): string
    {
        if ($selected === [] || trim($html) === '') {
            return $html;
        }
        try {
            $doc = HTMLDocument::createFromString('<body>' . $html . '</body>', LIBXML_NOERROR);
            $body = $doc->body;
            if ($body === null) {
                return $html;
            }
            // number every heading first (document order), and note which ones are chosen or hold a chosen one
            $position = 0;
            $numbers = array();
            foreach ($body->querySelectorAll('h1, h2, h3, h4, h5, h6') as $heading) {
                $position++;
                $numbers[] = array($heading, $position);
            }
            $chosen = array();
            $kept = array();
            foreach ($numbers as [$heading, $number]) {
                if (in_array($number, $selected, true)) {
                    $chosen[] = $heading;
                    $kept[] = $heading;
                    // the headings above it (a section inside a section) stay as its context
                    for ($up = $heading->parentNode; $up instanceof Element && $up !== $body; $up = $up->parentNode) {
                        $kept[] = $up;
                    }
                }
            }
            // headings above in rank: the nearest earlier heading of a lower level holds this one
            $levels = array();
            foreach ($numbers as [$heading, $number]) {
                $levels[] = array($heading, (int) $heading->tagName[1]);
            }
            foreach ($levels as $index => [$heading, $level]) {
                if (!self::contains($chosen, $heading)) {
                    continue;
                }
                $needed = $level;
                for ($before = $index - 1; $before >= 0 && $needed > 1; $before--) {
                    if ($levels[$before][1] < $needed) {
                        $kept[] = $levels[$before][0];
                        $needed = $levels[$before][1];
                    }
                }
            }
            $keepContent = false;
            self::filterChildren($body, $chosen, $kept, $keepContent);
            return self::bodyHtml($body);
        } catch (Throwable) {
            return $html;
        }
    }

    /** A line above the text saying it is a part of the entry. */
    public static function selectedNote(): string
    {
        return '<p style="color:#555;font-size:9pt;margin:0 0 6pt 0;">Selected sections only</p>';
    }

    /**
     * Draws every spreadsheet of the body like the grid on screen. A sheet wider than the printable page width ($pageWidthPx) is scaled
     * down, text, borders, padding and row heights together, so that it is exactly as wide as the page; a narrower one is left at 100%.
     */
    public static function spreadsheets(string $html, ?float $pageWidthPx = null): string
    {
        if (!str_contains($html, 'elabftw-spreadsheet')) {
            return $html;
        }
        try {
            $doc = HTMLDocument::createFromString('<body>' . $html . '</body>', LIBXML_NOERROR);
            $body = $doc->body;
            if ($body === null) {
                return $html;
            }
            foreach ($body->querySelectorAll('table.elabftw-spreadsheet') as $table) {
                self::prepareTable($table, $pageWidthPx);
            }
            return self::bodyHtml($body);
        } catch (Throwable) {
            return $html;
        }
    }

    /** The child elements of an element, in order. */
    private static function kids(Element $parent): array
    {
        $kids = array();
        for ($child = $parent->firstElementChild; $child !== null; $child = $child->nextElementSibling) {
            $kids[] = $child;
        }
        return $kids;
    }

    private static function contains(array $list, Node $node): bool
    {
        foreach ($list as $item) {
            if ($item === $node) {
                return true;
            }
        }
        return false;
    }

    private static function bodyHtml(Element $body): string
    {
        return $body->innerHTML;
    }

    /**
     * Walks the children in order: a heading that is kept stays, the content that follows a chosen heading stays up to the next heading.
     */
    private static function filterChildren(Element $parent, array $chosen, array $kept, bool &$showContent): void
    {
        foreach (self::kids($parent) as $element) {
            if (in_array($element->tagName, array('H1', 'H2', 'H3', 'H4', 'H5', 'H6'), true)) {
                $showContent = self::contains($chosen, $element);
                if (!self::contains($kept, $element)) {
                    $element->remove();
                }
                continue;
            }
            if ($element->querySelector('h1, h2, h3, h4, h5, h6') !== null) {
                self::filterChildren($element, $chosen, $kept, $showContent);
                if (self::kids($element) === array() && trim($element->textContent ?? '') === '') {
                    $element->remove();
                }
                continue;
            }
            if (!$showContent) {
                $element->remove();
            }
        }
    }

    private static function prepareTable(Element $table, ?float $pageWidthPx = null): void
    {
        $table->removeAttribute('data-spreadsheet');
        self::removeHidden($table);
        self::trimEmptyEdges($table);
        $total = 0;
        foreach ($table->querySelectorAll('colgroup > col') as $col) {
            $total += self::pixels($col->getAttribute('style') ?? '') ?: (int) ($col->getAttribute('width') ?? 0);
        }
        $style = (string) $table->getAttribute('style');
        // the grid has no outer frame of its own; the lines come from the cells
        $style = (string) preg_replace('/(?:^|;)\s*(?:width|max-width|min-width|height|border(?:-[a-z]+)?)\s*:[^;]*/i', '', $style);
        $style = trim($style, "; \t\n") . ';border-collapse:collapse;table-layout:fixed;border:' . self::GRID_LINE . ';margin:6px 0;';
        if ($total > 0) {
            $style .= 'width:' . $total . 'px;';
        }
        $scale = ($pageWidthPx !== null && $total > $pageWidthPx) ? $pageWidthPx / $total : 1.0;
        if ($scale < 1.0) {
            // wider than the page: every size shrinks by the same factor, so the table is exactly as wide as the page
            $style = (string) preg_replace('/width:\d+px;/', 'width:' . (int) floor($pageWidthPx) . 'px;', $style) . 'font-size:' . round(9 * $scale, 2) . 'pt;';
            foreach ($table->querySelectorAll('colgroup > col') as $col) {
                $col->setAttribute('style', 'width:' . round(self::pixels((string) $col->getAttribute('style')) * $scale, 2) . 'px');
            }
        }
        $table->setAttribute('style', $style);
        foreach ($table->querySelectorAll('tr') as $row) {
            $rowStyle = self::scalePixels(trim((string) $row->getAttribute('style'), "; "), $scale);
            $row->setAttribute('style', $rowStyle . ';background-color:#ffffff;page-break-inside:avoid;');
        }
        foreach ($table->querySelectorAll('th, td') as $cell) {
            $coordinate = $cell->classList->contains('spreadsheet-coordinate');
            $extra = 'border:' . self::GRID_LINE . ';padding:' . round(3 * $scale, 2) . 'px ' . round(5 * $scale, 2) . 'px;overflow:hidden;';
            if ($coordinate) {
                $extra .= 'text-align:center;text-transform:none;font-weight:normal;';
                if (!preg_match('/background(?:-color)?\s*:/i', (string) $cell->getAttribute('style'))) {
                    $extra .= 'background-color:#f3f3f3;';
                }
                if (!preg_match('/(?:^|;)\s*color\s*:/i', (string) $cell->getAttribute('style'))) {
                    $extra .= 'color:#555555;';
                }
            }
            // a cell with no fill of its own is white (the page's zebra rule would stripe it otherwise)
            if (!$coordinate && !preg_match('/background(?:-color)?\s*:/i', (string) $cell->getAttribute('style'))) {
                $extra .= 'background-color:#ffffff;';
            }
            // what the person set on the cell (fill, bold, colour, alignment, number format) comes last and wins
            $cell->setAttribute('style', $extra . self::scalePixels(trim((string) $cell->getAttribute('style'), "; "), $scale) . ';');
        }
    }

    /** The pixel sizes of a style attribute (heights, widths, font sizes, paddings) multiplied by $scale; 1 leaves it as it is. */
    private static function scalePixels(string $style, float $scale): string
    {
        if ($scale >= 1.0 || $style === '') {
            return $style;
        }
        return (string) preg_replace_callback('/(\d+(?:\.\d+)?)px/', static fn(array $m): string => round((float) $m[1] * $scale, 2) . 'px', $style);
    }

    private static function pixels(string $style): int
    {
        return preg_match('/width\s*:\s*(\d+(?:\.\d+)?)px/i', $style, $match) === 1 ? (int) round((float) $match[1]) : 0;
    }

    /** Columns and rows the person hid are not printed (the screen does not show them either). */
    private static function removeHidden(Element $table): void
    {
        foreach ($table->querySelectorAll('tr') as $row) {
            if (self::isHidden($row)) {
                $row->remove();
            }
        }
        $drop = array();
        $first = $table->querySelector('tr');
        if ($first !== null) {
            foreach (self::kids($first) as $index => $cell) {
                if (self::isHidden($cell)) {
                    $drop[] = $index;
                }
            }
        }
        if ($drop === []) {
            return;
        }
        foreach ($table->querySelectorAll('tr') as $row) {
            $cells = array();
            foreach (self::kids($row) as $cell) {
                $cells[] = $cell;
            }
            foreach ($drop as $index) {
                if (isset($cells[$index])) {
                    $cells[$index]->remove();
                }
            }
        }
        $cols = array();
        foreach ($table->querySelectorAll('colgroup > col') as $col) {
            $cols[] = $col;
        }
        foreach ($drop as $index) {
            if (isset($cols[$index])) {
                $cols[$index]->remove();
            }
        }
    }

    private static function isHidden(Element $element): bool
    {
        return $element->hasAttribute('hidden') || preg_match('/display\s*:\s*none/i', (string) $element->getAttribute('style')) === 1;
    }

    /** Empty filler columns on the right and empty rows at the bottom (no text, no fill) are left out. */
    private static function trimEmptyEdges(Element $table): void
    {
        $rows = array();
        foreach ($table->querySelectorAll('tbody tr') as $row) {
            $rows[] = $row;
        }
        if ($rows === []) {
            return;
        }
        $isEmpty = static function (Element $cell): bool {
            return trim($cell->textContent ?? '') === ''
                && preg_match('/background(?:-color)?\s*:\s*(?!(?:#fff(?:fff)?|white|transparent|none)\b)/i', (string) $cell->getAttribute('style')) !== 1;
        };
        // the data cells of a row, without its coordinate cell
        $dataCells = static function (Element $row): array {
            $cells = array();
            foreach (self::kids($row) as $cell) {
                if (!$cell->classList->contains('spreadsheet-coordinate')) {
                    $cells[] = $cell;
                }
            }
            return $cells;
        };
        // rows at the bottom
        for ($i = count($rows) - 1; $i > 0; $i--) {
            $empty = true;
            foreach ($dataCells($rows[$i]) as $cell) {
                if (!$isEmpty($cell)) {
                    $empty = false;
                    break;
                }
            }
            if (!$empty) {
                break;
            }
            $rows[$i]->remove();
        }
        // columns on the right
        $rowCells = array();
        foreach ($table->querySelectorAll('tbody tr') as $row) {
            $rowCells[] = $dataCells($row);
        }
        $width = 0;
        foreach ($rowCells as $cells) {
            $width = max($width, count($cells));
        }
        $lastUsed = 0;
        foreach ($rowCells as $cells) {
            foreach ($cells as $index => $cell) {
                if (!$isEmpty($cell)) {
                    $lastUsed = max($lastUsed, $index + 1);
                }
            }
        }
        $keep = max(1, $lastUsed);
        if ($keep >= $width) {
            return;
        }
        foreach ($rowCells as $cells) {
            foreach ($cells as $index => $cell) {
                if ($index >= $keep) {
                    $cell->remove();
                }
            }
        }
        // the header row stays in step with the data (a coordinate gutter cell comes first when the table has one)
        $gutter = $table->querySelector('tbody tr > .spreadsheet-coordinate') !== null ? 1 : 0;
        $head = $table->querySelector('thead tr');
        if ($head !== null) {
            $headCells = array();
            foreach (self::kids($head) as $cell) {
                $headCells[] = $cell;
            }
            foreach ($headCells as $index => $cell) {
                if ($index >= $keep + $gutter) {
                    $cell->remove();
                }
            }
        }
        $cols = array();
        foreach ($table->querySelectorAll('colgroup > col') as $col) {
            $cols[] = $col;
        }
        foreach ($cols as $index => $col) {
            if ($index >= $keep + $gutter) {
                $col->remove();
            }
        }
    }
}
