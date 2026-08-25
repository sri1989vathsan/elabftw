<?php

declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Services;

use DateTimeImmutable;
use Elabftw\Exceptions\ImproperActionException;

use function str_repeat;
use function hash;
use function uniqid;

class FilterTest extends \PHPUnit\Framework\TestCase
{
    public function testFormatLocalDate(): void
    {
        $input = '2024-10-16 17:12:47';
        $expected = array(
            'date' => '2024-10-16',
            'time' => '17:12:47',
        );
        $this->assertEquals($expected, Filter::separateDateAndTime($input));

        $input = '2024-10-16';
        $expected = array(
            'date' => '2024-10-16',
            'time' => '',
        );
        $this->assertEquals($expected, Filter::separateDateAndTime($input));

        $input = '';
        $expected = array(
            'date' => '',
            'time' => '',
        );
        $this->assertEquals($expected, Filter::separateDateAndTime($input));
        $this->assertSame('Monday, July 14, 2025', Filter::formatLocalDate(new DateTimeImmutable('2025-07-14')));
    }

    public function testTitle(): void
    {
        $this->assertEquals('My super title', Filter::title('My super title'));
        $this->assertEquals('Yep Yop Yip Yup', Filter::title("Yep\r\nYop\nYip\rYup"));
        $this->assertEquals('Untitled', Filter::title(''));
        $this->assertEquals('Untitled', Filter::title(' '));
        $this->assertEquals('no whitespace around', Filter::title(' no whitespace around '));
        // test a too long string
        $this->assertEquals(str_repeat('A', 255), Filter::title(str_repeat('A', 260)));
    }

    public function testBody(): void
    {
        $this->assertEquals('my body', Filter::body('my body'));
        $this->assertEquals('my body', Filter::body('my body<script></script>'));
        $this->expectException(ImproperActionException::class);
        Filter::body(str_repeat('a', 4120001));
    }

    public function testBodyAllowsInternalLinksToOpenInNewWindow(): void
    {
        $link = '<a href="/experiments/1" target="_blank" rel="noreferrer noopener">Experiment</a>';
        $this->assertSame($link, Filter::body($link));

        $folderLink = '<a href="elabftw-folder://open/84f0b17b-6d9a-4b52-9429-6fbdf663b424">Microscopy data</a>';
        $this->assertSame($folderLink, Filter::body($folderLink));

        $this->assertSame(
            '<a href="/experiments/1">Experiment</a>',
            Filter::body('<a href="/experiments/1" target="_top">Experiment</a>'),
        );
    }

    public function testBodyPreservesSpreadsheetAndNestedListMetadata(): void
    {
        $spreadsheet = '<table class="elabftw-spreadsheet" data-spreadsheet="eyJkYXRhIjpbXX0=" data-spreadsheet-style="well-plate" data-well-plate="96" style="border-collapse: collapse; border: 1px solid #000000;"><caption>Plate results</caption><thead><tr><th class="spreadsheet-coordinate">1</th></tr></thead><tbody><tr><td style="border: 3px solid #ff0000; background-color: #ffffff; padding: 4px; vertical-align: middle;">42</td></tr></tbody></table>';
        $result = Filter::body($spreadsheet);
        $this->assertStringContainsString('class="elabftw-spreadsheet"', $result);
        $this->assertStringContainsString('data-spreadsheet="eyJkYXRhIjpbXX0="', $result);
        $this->assertStringContainsString('data-spreadsheet-style="well-plate"', $result);
        $this->assertStringContainsString('data-well-plate="96"', $result);
        $this->assertStringContainsString('<caption>Plate results</caption>', $result);
        $this->assertStringContainsString('<thead>', $result);
        $this->assertStringContainsString('border-collapse:collapse', $result);
        $this->assertStringContainsString('border:1px solid #000000', $result);
        $this->assertStringContainsString('border:3px solid #ff0000', $result);
        $this->assertStringContainsString('background-color:#ffffff', $result);
        $this->assertStringContainsString('padding:4px', $result);
        $this->assertStringContainsString('vertical-align:middle', $result);

        $list = Filter::body('<ul><li style="list-style-type: none;"><ul><li>Nested item</li></ul></li></ul>');
        $this->assertStringContainsString('list-style-type:none', $list);

        $checklist = Filter::body('<ul class="elabftw-checklist"><li class="elabftw-checklist-item" data-checked="true">Completed item</li><li class="elabftw-checklist-item" data-checked="false">Open item</li></ul>');
        $this->assertStringContainsString('class="elabftw-checklist"', $checklist);
        $this->assertStringContainsString('class="elabftw-checklist-item"', $checklist);
        $this->assertStringContainsString('data-checked="true"', $checklist);
        $this->assertStringContainsString('data-checked="false"', $checklist);

        $heading = Filter::body('<h2 id="section-results">Results</h2>');
        $this->assertStringContainsString('<h2 id="section-results">Results</h2>', $heading);

        $titleHeading = Filter::body('<h1 id="experiment-title-42" style="font-size:24pt;font-family:Arial, sans-serif;color:#123456;font-weight:bold;font-style:italic;text-decoration:underline;text-align:center">Experiment title</h1>');
        $this->assertStringContainsString('id="experiment-title-42"', $titleHeading);
        $this->assertStringContainsString('font-size:24pt', $titleHeading);
        $this->assertStringContainsString('font-family:Arial, sans-serif', $titleHeading);
        $this->assertStringContainsString('color:#123456', $titleHeading);
        $this->assertStringContainsString('text-align:center', $titleHeading);

        $date = Filter::body('<a id="date-2026-07-29-abcd1234" class="elabftw-date-reference" href="experiments.php?mode=view&amp;id=42" title="Linked date"><span class="elabftw-date-icon"><span class="elabftw-date-icon-month" title="JUL">&#8203;</span><span class="elabftw-date-icon-day" title="29">&#8203;</span></span><time datetime="2026-07-29">20260729</time></a>');
        $this->assertStringContainsString('id="date-2026-07-29-abcd1234"', $date);
        $this->assertStringContainsString('class="elabftw-date-reference"', $date);
        $this->assertStringContainsString('href="experiments.php?mode=view&amp;id=42"', $date);
        $this->assertStringContainsString('<span class="elabftw-date-icon-month" title="JUL">', $date);
        $this->assertStringContainsString('<span class="elabftw-date-icon-day" title="29">', $date);
        $this->assertStringNotContainsString('>JUL<', $date);
        $this->assertStringContainsString('<time datetime="2026-07-29">20260729</time>', $date);

        $headingDate = Filter::body('<h2 id="date-2026-07-29-heading"><a class="elabftw-date-reference" href="experiments.php?mode=view&amp;id=42"><time datetime="2026-07-29">29 July 2026</time></a></h2>');
        $this->assertStringContainsString('<h2 id="date-2026-07-29-heading">', $headingDate);
        $this->assertStringContainsString('<time datetime="2026-07-29">29 July 2026</time>', $headingDate);

        $rules = Filter::body('<hr class="elabftw-single-rule"><hr class="elabftw-double-rule"><hr class="elabftw-dashed-rule"><hr class="elabftw-double-dashed-rule">');
        $this->assertStringContainsString('class="elabftw-single-rule"', $rules);
        $this->assertStringContainsString('class="elabftw-double-rule"', $rules);
        $this->assertStringContainsString('class="elabftw-dashed-rule"', $rules);
        $this->assertStringContainsString('class="elabftw-double-dashed-rule"', $rules);

        $collapsible = Filter::body('<details class="elabftw-collapsible-table" open><summary class="elabftw-collapsible-table-summary">Results</summary><table><tbody><tr><td>42</td></tr></tbody></table></details>');
        $this->assertStringContainsString('class="elabftw-collapsible-table"', $collapsible);
        $this->assertStringContainsString('class="elabftw-collapsible-table-summary"', $collapsible);
        $this->assertStringContainsString('<summary', $collapsible);
        $this->assertStringContainsString('<table>', $collapsible);
    }

    public function testForFilesystem(): void
    {
        $this->assertEquals('blah', Filter::forFilesystem('=blah/'));
        $this->assertEquals('.pdf', Filter::forFilesystem("=bl사회과학원 어 학연구소찦차를 타고 온 펲시맨과 쑛다리 똠방각하η†ah/'\n.pdf"));
        $this->assertEquals('23MJ.gif_th.jpg', Filter::forFilesystem('|23MJ.gif_th.jpg'));
    }

    public function testHexits(): void
    {
        // we use uniqid here so it changes every time
        $input = hash('sha512', uniqid('', true));
        $this->assertEquals($input, Filter::hexits($input));
        $this->assertEquals('abc', Filter::hexits('zzzazzzbzzzczzz'));
        $this->assertEmpty(Filter::hexits('zzzzz'));
    }

    public function testToPureString(): void
    {
        $this->assertEquals('Roger', Filter::toPureString('<a href="attacker.com">Roger</a>'));
        $this->assertEquals('Roger', Filter::toPureString('<script>alert(1)</script><strong>Roger</strong>'));
        $this->assertEquals('Rabbit', Filter::toPureString('<i onwheel=alert(224)>Rabbit</i>'));
    }

    public function testIntOrNull(): void
    {
        $this->assertNull(Filter::intOrNull(''));
        $this->assertSame(42, Filter::intOrNull('42'));
    }
}
