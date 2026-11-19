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
    public const string MODE_LANDSCAPE = 'landscape';
    public const string MODE_FIT = 'fit';
    public const string MODE_SPLIT = 'split';
    // a sheet that would have to shrink below this on a portrait page goes on a landscape page
    private const float MIN_PORTRAIT_SCALE = 0.7;
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
     * Draws every spreadsheet of the body like the grid on screen. $mode says what to do with a sheet wider than the page:
     * 'landscape' (default): scaled to the portrait page width when that keeps at least 70%, else on a landscape page (scaled to its width
     * when still wider); 'fit': always portrait, scaled to the page width; 'split': actual size, the columns that do not fit continue on the
     * next page (first column, row numbers and header row repeated). A narrower sheet is left at 100% in every mode.
     * $landscapeWidthPx is the printable width of a landscape page.
     */
    public static function spreadsheets(string $html, ?float $pageWidthPx = null, string $mode = self::MODE_LANDSCAPE, ?float $landscapeWidthPx = null): string
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
                self::prepareTable($table, $pageWidthPx, $mode, $landscapeWidthPx);
            }
            // mPDF switches the page orientation with <pagebreak>
            return str_replace(
                array('<div class="pdf-landscape-begin"></div>', '<div class="pdf-landscape-end"></div>', '<div class="pdf-page-break"></div>'),
                array('<pagebreak orientation="L" />', '<pagebreak orientation="P" />', '<pagebreak />'),
                self::bodyHtml($body),
            );
        } catch (Throwable) {
            return $html;
        }
    }

    /** The "Sheets in print and PDF" choice of the request (sheets=landscape|fit|split); anything else is the default. */
    public static function parseMode(string $raw): string
    {
        return in_array($raw, array(self::MODE_FIT, self::MODE_SPLIT), true) ? $raw : self::MODE_LANDSCAPE;
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

    private static function prepareTable(Element $table, ?float $pageWidthPx, string $mode, ?float $landscapeWidthPx): void
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
        // which page and how much smaller than 100%
        $landscape = false;
        $target = $pageWidthPx;
        if ($pageWidthPx !== null && $total > $pageWidthPx && $mode === self::MODE_LANDSCAPE && $pageWidthPx / $total < self::MIN_PORTRAIT_SCALE && $landscapeWidthPx !== null) {
            $landscape = true;
            $target = $landscapeWidthPx;
        }
        $scale = ($target !== null && $total > $target && $mode !== self::MODE_SPLIT) ? $target / $total : 1.0;
        if ($mode === self::MODE_SPLIT && $pageWidthPx !== null && $total > $pageWidthPx && !self::hasMergedCells($table)) {
            self::styleCells($table, 1.0);
            $table->setAttribute('style', $style);
            self::splitIntoBlocks($table, $pageWidthPx);
            return;
        }
        if ($scale < 1.0) {
            // wider than the page: every size shrinks by the same factor, so the table is exactly as wide as the page
            $style = (string) preg_replace('/width:\d+px;/', 'width:' . (int) floor((float) $target) . 'px;', $style) . 'font-size:' . round(9 * $scale, 2) . 'pt;';
            foreach ($table->querySelectorAll('colgroup > col') as $col) {
                $col->setAttribute('style', 'width:' . round(self::pixels((string) $col->getAttribute('style')) * $scale, 2) . 'px');
            }
        }
        $table->setAttribute('style', $style);
        self::styleCells($table, $scale);
        if ($landscape) {
            $doc = $table->ownerDocument;
            $begin = $doc->createElement('div');
            $begin->setAttribute('class', 'pdf-landscape-begin');
            $end = $doc->createElement('div');
            $end->setAttribute('class', 'pdf-landscape-end');
            $table->before($begin);
            $table->after($end);
        }
    }

    /** Grid lines, white cells, grey coordinate cells and tight padding; sizes multiplied by $scale. */
    private static function styleCells(Element $table, float $scale): void
    {
        foreach ($table->querySelectorAll('tr') as $row) {
            // the row is as high as its content (a live row height is the content plus the grid's padding)
            $rowStyle = trim((string) preg_replace('/(?:^|;)\s*height\s*:[^;]*/i', '', (string) $row->getAttribute('style')), "; ");
            $row->setAttribute('style', self::scalePixels($rowStyle, $scale) . ';background-color:#ffffff;page-break-inside:avoid;');
        }
        foreach ($table->querySelectorAll('th, td') as $cell) {
            $coordinate = $cell->classList->contains('spreadsheet-coordinate');
            $extra = 'border:' . self::GRID_LINE . ';padding:' . round(1.5 * $scale, 2) . 'px ' . round(4 * $scale, 2) . 'px;overflow:hidden;';
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
            // what the person set on the cell (fill, bold, colour, alignment, number format) comes last and wins; padding and height are ours
            $own = trim((string) preg_replace('/(?:^|;)\s*(?:padding(?:-[a-z]+)?|height)\s*:[^;]*/i', '', (string) $cell->getAttribute('style')), "; ");
            $cell->setAttribute('style', $extra . self::scalePixels($own, $scale) . ';');
        }
    }

    /**
     * Actual size: the columns that do not fit the page width go on following pages, each block with the row-number column, the header row
     * and a note naming its columns. A column wider than the page alone is shrunk to the page (never cut).
     */
    private static function splitIntoBlocks(Element $table, float $pageWidthPx): void
    {
        $cols = array();
        foreach ($table->querySelectorAll('colgroup > col') as $col) {
            $cols[] = $col;
        }
        $gutter = $table->querySelector('tbody tr > .spreadsheet-coordinate') !== null ? 1 : 0;
        $widths = array();
        foreach ($cols as $col) {
            $widths[] = (float) self::pixels((string) $col->getAttribute('style'));
        }
        $gutterWidth = $gutter === 1 ? ($widths[0] ?? 0.0) : 0.0;
        $room = max(40.0, $pageWidthPx - $gutterWidth);
        $blocks = array();
        $current = array();
        $used = 0.0;
        for ($index = $gutter, $last = count($widths); $index < $last; $index++) {
            $w = min($widths[$index], $room);
            if ($current !== array() && $used + $w > $room) {
                $blocks[] = $current;
                $current = array();
                $used = 0.0;
            }
            $current[] = $index;
            $used += $w;
        }
        if ($current !== array()) {
            $blocks[] = $current;
        }
        if (count($blocks) < 2) {
            return;
        }
        $doc = $table->ownerDocument;
        $letters = array();
        $head = $table->querySelector('thead tr');
        if ($head !== null) {
            foreach (self::kids($head) as $i => $cell) {
                $letters[$i] = trim($cell->textContent ?? '');
            }
        }
        $original = $table->cloneNode(true);
        $anchor = $table;
        foreach ($blocks as $number => $block) {
            $copy = $number === 0 ? $table : $original->cloneNode(true);
            $keep = array_merge($gutter === 1 ? array(0) : array(), $block);
            foreach ($copy->querySelectorAll('tr') as $row) {
                foreach (self::kids($row) as $i => $cell) {
                    if (!in_array($i, $keep, true)) {
                        $cell->remove();
                    }
                }
            }
            $blockWidth = 0.0;
            foreach ($copy->querySelectorAll('colgroup > col') as $i => $col) {
                if (!in_array($i, $keep, true)) {
                    $col->remove();
                    continue;
                }
                $w = $i === 0 && $gutter === 1 ? $widths[0] : min($widths[$i], $room);
                $col->setAttribute('style', 'width:' . round($w, 2) . 'px');
                $blockWidth += $w;
            }
            $copy->setAttribute('style', (string) preg_replace('/width:[\d.]+px;?/', '', (string) $copy->getAttribute('style')) . 'width:' . round($blockWidth, 2) . 'px;');
            $from = $letters[$block[0]] ?? '';
            $to = $letters[$block[count($block) - 1]] ?? '';
            $note = $doc->createElement('p');
            $note->setAttribute('style', 'color:#555;font-size:8pt;margin:4pt 0 0 0;');
            $note->textContent = $from === $to ? 'column ' . $from : 'columns ' . $from . '-' . $to;
            if ($number === 0) {
                $table->before($note);
            } else {
                $break = $doc->createElement('div');
                $break->setAttribute('class', 'pdf-page-break');
                $anchor->after($break);
                $break->after($note);
                $note->after($copy);
                $anchor = $copy;
            }
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
        // merged cells (colspan/rowspan) break the "same column index in every row" assumption: such a sheet keeps its columns
        if ($drop === [] || self::hasMergedCells($table)) {
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

    private static function hasMergedCells(Element $table): bool
    {
        return $table->querySelector('td[colspan], td[rowspan], th[colspan]:not(.spreadsheet-coordinate), th[rowspan]') !== null;
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
                && preg_match('/background(?:-color)?\s*:\s*(?!(?:#fff(?:fff)?|#f[0-9a-f]f[0-9a-f]f[0-9a-f]|white|transparent|none)\b)/i', (string) $cell->getAttribute('style')) !== 1;
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
        if ($keep >= $width || self::hasMergedCells($table)) {
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
