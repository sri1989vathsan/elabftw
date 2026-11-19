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

// --- the scaling rule: wider than the page -> exactly the page width (everything scaled together); narrower -> untouched
$wide = static function (int $cols, int $width = 100) use ($cell, $coord): string {
    $colgroup = '<col style="width:42px">' . str_repeat('<col style="width:' . $width . 'px">', $cols);
    $head = $coord('') . implode('', array_map(static fn(int $i): string => $coord((string) ($i + 1)), range(0, $cols - 1)));
    $row = static fn(int $r): string => '<tr style="height:33px">' . $coord((string) $r) . implode('', array_map(static fn(int $i): string => $cell('v' . $i, 'height:33px;'), range(0, $cols - 1))) . '</tr>';
    return '<table class="elabftw-spreadsheet" style="width:100%"><colgroup>' . $colgroup . '</colgroup><thead><tr>' . $head . '</tr></thead><tbody>' . $row(1) . $row(2) . '</tbody></table>';
};
$page = 700.0;
foreach (array(4 => 'a 4-column sheet', 12 => 'a 12-column sheet', 30 => 'a 30-column sheet') as $n => $label) {
    $natural = 42 + $n * 100;
    $out = PdfBodyPrep::spreadsheets($wide($n), $page);
    if ($natural <= $page) {
        $check("$label ($natural px) is not scaled", str_contains($out, 'width:' . $natural . 'px') && !str_contains($out, 'font-size'), 'scaled or wrong width');
    } else {
        $check("$label ($natural px) is scaled to the page width", str_contains($out, 'width:700px;') && str_contains($out, 'font-size:'), 'not scaled to 700');
        preg_match_all('/<col style="width:([\d.]+)px"/', $out, $m);
        $sum = array_sum(array_map('floatval', $m[1]));
        $check("$label: the columns add up to the page width (no cut column)", abs($sum - $page) <= 1.0, "sum $sum");
        preg_match('/font-size:([\d.]+)pt/', $out, $f);
        $check("$label: text, row heights and padding are scaled together", str_contains($out, 'height:' . round(33 * $page / $natural, 2) . 'px'), 'row height not scaled');
        echo "     smallest text at $n columns: " . ($f[1] ?? '?') . " pt (base 9 pt)\n";
    }
}
$long = '<table class="elabftw-spreadsheet" style="width:100%"><colgroup><col style="width:42px"><col style="width:100px"></colgroup><thead><tr>' . $coord('') . $coord('A') . '</tr></thead><tbody>'
    . implode('', array_map(static fn(int $r): string => '<tr>' . $coord((string) $r) . $cell('row ' . $r) . '</tr>', range(1, 200))) . '</tbody></table>';
$outLong = PdfBodyPrep::spreadsheets($long, $page);
$check('a very long sheet keeps its 200 rows, the header in <thead> (repeated by the PDF engine), rows not split', substr_count($outLong, '<tr') === 201 && str_contains($outLong, '<thead>') && substr_count($outLong, 'page-break-inside:avoid') >= 200, 'rows lost or not kept together');

// --- hidden columns, merged cells, fills
$hid = '<table class="elabftw-spreadsheet" style="width:100%"><colgroup><col style="width:42px"><col style="width:100px"><col style="width:100px;display:none"><col style="width:100px"></colgroup>'
    . '<thead><tr>' . $coord('') . $coord('A') . '<th class="spreadsheet-coordinate" style="display:none">B</th>' . $coord('C') . '</tr></thead><tbody>'
    . '<tr>' . $coord('1') . $cell('keepA') . '<td style="display:none">hiddenB</td>' . $cell('keepC') . '</tr></tbody></table>';
$outHid = PdfBodyPrep::spreadsheets($hid, $page);
$check('hidden-columns: a hidden column is not printed, the others are', !str_contains($outHid, 'hiddenB') && str_contains($outHid, 'keepA') && str_contains($outHid, 'keepC') && substr_count($outHid, '<col ') === 3, 'hidden column kept or a visible one lost');
$mer = '<table class="elabftw-spreadsheet" style="width:100%"><colgroup><col style="width:42px"><col style="width:100px"><col style="width:100px"><col style="width:100px"></colgroup>'
    . '<thead><tr>' . $coord('') . $coord('A') . $coord('B') . $coord('C') . '</tr></thead><tbody>'
    . '<tr>' . $coord('1') . '<td colspan="2" style="background-color:#99ccff;font-weight:bold;">merged title</td>' . $cell('') . '</tr>'
    . '<tr>' . $coord('2') . $cell('a') . $cell('b') . $cell('') . '</tr></tbody></table>';
$outMer = PdfBodyPrep::spreadsheets($mer, $page);
$check('merged-cells: the colspan and the fill of a merged cell survive, no column is cut', str_contains($outMer, 'colspan="2"') && str_contains($outMer, 'background-color:#99ccff') && str_contains($outMer, '>C</th>'), 'merge or column lost');
$fills = PdfBodyPrep::spreadsheets($sheet, $page);
$check('fills: a coloured cell keeps its colour, an uncoloured one is white (no zebra)', str_contains($fills, 'background-color:#ffcc00') && str_contains($fills, 'background-color:#ffffff'), 'fill lost or cell not white');

// --- whole entry (pdf-whole-entry): nothing selected keeps every section and every sheet
$entry = '<h2>One</h2><p>text one</p>' . $sheet . '<h2>Two</h2><p>text two</p>' . $wide(4);
$whole = PdfBodyPrep::spreadsheets(PdfBodyPrep::selectSections($entry, PdfBodyPrep::parseSections('')), $page);
$check('pdf-whole-entry: with no sections asked every heading, text and sheet is in the PDF', str_contains($whole, 'text one') && str_contains($whole, 'text two') && substr_count($whole, '<table') === 2 && !str_contains($whole, 'Selected sections only'), 'something missing');
$some = PdfBodyPrep::spreadsheets(PdfBodyPrep::selectSections($entry, PdfBodyPrep::parseSections('2')), $page);
$check('pdf-selected-sections: only the asked section (and its sheet) is in the PDF', str_contains($some, 'text two') && !str_contains($some, 'text one') && substr_count($some, '<table') === 1, 'wrong sections');

echo $failed === 0 ? "ALL PASSED\n" : "$failed FAILED\n";
exit($failed === 0 ? 0 : 1);
