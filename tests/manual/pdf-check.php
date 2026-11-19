<?php
/**
 * PDF export checks: spreadsheets drawn as the grid (pdf-matches-live) and selected sections only (pdf-selected-sections).
 *
 *   docker exec -i <web container> php < tests/manual/pdf-check.php
 *
 * Runs PdfBodyPrep on made-up bodies (nothing is read or written) and prints one line per check; exit code 1 when one fails.
 */
require '/elabftw/src/Make/PdfBodyPrep.php';

use Elabftw\Make\PdfBodyPrep;

$failed = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$failed): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : ' -- ' . $detail) . "\n";
    if (!$ok) {
        $failed++;
    }
};

$cell = static fn(string $v, string $style = ''): string => '<td style="border:1px solid #ced4da;padding:8px;' . $style . '">' . $v . '</td>';
$coord = static fn(string $v): string => '<th class="spreadsheet-coordinate" style="width:42px;">' . $v . '</th>';
$sheet = '<table class="elabftw-spreadsheet" data-spreadsheet="BLOB" style="width:100%"><colgroup><col style="width:42px"><col style="width:120px"><col style="width:90px"><col style="width:100px"><col style="width:100px"></colgroup>'
    . '<thead><tr>' . $coord('') . $coord('A') . $coord('B') . $coord('C') . $coord('D') . '</tr></thead><tbody>'
    . '<tr>' . $coord('1') . $cell('head', 'font-weight:bold;background-color:#ffcc00;') . $cell('7', 'text-align:right;') . $cell('') . $cell('') . '</tr>'
    . '<tr>' . $coord('2') . $cell('x') . $cell('') . $cell('') . $cell('') . '</tr>'
    . '<tr>' . $coord('3') . $cell('') . $cell('') . $cell('') . $cell('') . '</tr>'
    . '</tbody></table>';

// --- pdf-matches-live
$out = PdfBodyPrep::spreadsheets('<p>before</p>' . $sheet . '<p>after</p>');
$check('the spreadsheet blob is not sent to the PDF', !str_contains($out, 'data-spreadsheet'), 'blob kept');
$check('grid lines on every cell', substr_count($out, 'border:1px solid #c8c8c8') >= 9, 'few borders');
$check('coordinate cells are grey and centred', str_contains($out, 'background-color:#f3f3f3') && str_contains($out, 'text-align:center'), 'no grey/centre');
$check('the fill and the bold of a cell are kept', str_contains($out, 'background-color:#ffcc00') && str_contains($out, 'font-weight:bold'), 'fill/bold lost');
$check('the alignment of a cell is kept', str_contains($out, 'text-align:right'), 'alignment lost');
$check('empty trailing rows are left out', !str_contains($out, '>3</th>'), 'row 3 kept');
$check('empty trailing columns are left out', !str_contains($out, '>C</th>') && !str_contains($out, '>D</th>') && substr_count($out, '<col ') === 3, 'columns C and D kept');
$check('the table is as wide as its columns', str_contains($out, 'width:252px'), 'width not 42+120+90');
$check('rows are not split over a page', str_contains($out, 'page-break-inside:avoid'), 'no page-break-inside');
$check('the text around the table is untouched', str_contains($out, '<p>before</p>') && str_contains($out, '<p>after</p>'), 'text changed');
$check('plain bodies without a spreadsheet are returned as they are', PdfBodyPrep::spreadsheets('<p>just text</p>') === '<p>just text</p>', 'changed');
$check('two spreadsheets in one entry are both drawn', substr_count(PdfBodyPrep::spreadsheets($sheet . $sheet), 'border-collapse:collapse') === 2, 'not both');

// --- pdf-selected-sections
$body = '<h2>Intro</h2><p>intro text</p><h2>Methods</h2><p>methods text</p><h3>Plate</h3><p>plate text</p><h2>Results</h2><p>results text</p><h2>Notes</h2><p>notes text</p>';
$all = PdfBodyPrep::selectSections($body, []);
$check('nothing selected exports everything', $all === $body, 'changed');
$pick = PdfBodyPrep::selectSections($body, [3, 4]);
$check('a selected section stays with its text', str_contains($pick, 'plate text') && str_contains($pick, 'results text'), $pick);
$check('the heading above a selected sub-section stays as its context', str_contains($pick, '<h2>Methods</h2>') && !str_contains($pick, 'methods text'), $pick);
$check('sections that were not selected are gone', !str_contains($pick, 'Intro') && !str_contains($pick, 'intro text') && !str_contains($pick, 'Notes') && !str_contains($pick, 'notes text'), $pick);
$one = PdfBodyPrep::selectSections($body, [5]);
$check('one section alone', str_contains($one, 'notes text') && !str_contains($one, 'results text') && !str_contains($one, 'Methods'), $one);
$withSheet = PdfBodyPrep::selectSections('<h2>A</h2>' . $sheet . '<h2>B</h2><p>b</p>', [1]);
$check('a spreadsheet inside a selected section stays', str_contains($withSheet, 'elabftw-spreadsheet') && !str_contains($withSheet, '<p>b</p>'), $withSheet);
$check('the sections of the request are read as positions', PdfBodyPrep::parseSections('3, 4,x,,9') === array(3, 4, 9), 'parse');
$check('a body without headings is left alone when sections are asked', PdfBodyPrep::selectSections('<p>text</p>', [1]) === '' || str_contains(PdfBodyPrep::selectSections('<p>text</p>', [1]), 'text') === false, 'kept');

echo $failed === 0 ? "ALL PASSED\n" : "$failed FAILED\n";
exit($failed === 0 ? 0 : 1);
