<?php

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Enums\BodyContentType;
use PHPUnit\Framework\TestCase;

final class CalendarActivityHeadingExtractorTest extends TestCase
{
    private CalendarActivityHeadingExtractor $Extractor;

    protected function setUp(): void
    {
        $this->Extractor = new CalendarActivityHeadingExtractor();
    }

    public function testHtmlHeadingsInheritExplicitDatesAndHierarchy(): void
    {
        $body = '<h1 id="overview">Overview</h1>'
            . '<p><a class="elabftw-date-reference"><time datetime="2026-08-19">19 August</time></a></p>'
            . '<h2>Procedure</h2><h3>Observation</h3>'
            . '<h1>Next section <a class="elabftw-date-reference"><time datetime="2026-08-20">20 August</time></a></h1>'
            . '<h2>Result</h2>';

        $headings = $this->Extractor->extract($body, BodyContentType::Html, '2026-08-18');

        $this->assertCount(5, $headings);
        $this->assertSame('2026-08-18', $headings[0]['date']);
        $this->assertSame('overview', $headings[0]['anchor']);
        $this->assertSame('2026-08-19', $headings[1]['date']);
        $this->assertSame($headings[1]['index'], $headings[2]['parent_index']);
        $this->assertSame('2026-08-20', $headings[3]['date']);
        $this->assertSame($headings[3]['index'], $headings[4]['parent_index']);
    }

    public function testMarkdownHeadingsUseEntityDate(): void
    {
        $headings = $this->Extractor->extract(
            "# Overview\n## Method\n### Result\n",
            BodyContentType::Markdown,
            '2026-08-19',
        );

        $this->assertCount(3, $headings);
        $this->assertSame('2026-08-19', $headings[2]['date']);
        $this->assertSame($headings[1]['index'], $headings[2]['parent_index']);
    }
}
