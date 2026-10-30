<?php

/**
 * The order sheets of the oligo suppliers, filled with the names and sequences of primers:
 * - IDT: the sheet to paste into the bulk input of the order page (name, sequence, scale, purification).
 * - Microsynth: their own upload form (microsynth-dna.xlsx, kept as it is: its checks and lists stay), the oligos are written in
 *   the sheet "DNA Order".
 *
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use RuntimeException;
use ZipArchive;

use function file_put_contents;
use function htmlspecialchars;
use function implode;
use function preg_replace;
use function preg_replace_callback;
use function sprintf;
use function strtoupper;
use function substr;
use function sys_get_temp_dir;
use function tempnam;

const ORDER_SHEET_VENDORS = array(
    'idt' => array(
        'label' => 'IDT',
        'scales' => array('25nm', '100nm', '250nm', '1um', '2um', '5um', '10um'),
        'purifications' => array('STD', 'PAGE', 'HPLC', 'IEHPLC', 'PAGEHPLC'),
        'scale' => '25nm',
        'purification' => 'STD',
    ),
    'microsynth' => array(
        'label' => 'Microsynth',
        'scales' => array('0.04', '0.2', '1.0', '15'),
        'purifications' => array('DES', 'HPL', 'HPD', 'IEX', 'PAG'),
        'scale' => '0.04',
        'purification' => 'DES',
    ),
);

function sheetXmlText(string $text): string
{
    return htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function sheetInline(string $reference, string $text, ?string $style = null): string
{
    return sprintf('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>', $reference, $style === null ? '' : ' s="' . $style . '"', sheetXmlText($text));
}

/**
 * The sheet for IDT: a new workbook with the four columns of their template
 *
 * @param list<array{name: string, sequence: string}> $oligos
 * @return string the path of a temporary file, to be removed by the caller
 */
function idtSheet(array $oligos, string $scale, string $purification): string
{
    $rows = array('<row r="1">' . sheetInline('A1', 'Name') . sheetInline('B1', 'Sequence') . sheetInline('C1', 'Scale') . sheetInline('D1', 'Purification') . '</row>');
    foreach ($oligos as $index => $oligo) {
        $n = $index + 2;
        $rows[] = sprintf('<row r="%d">%s%s%s%s</row>', $n, sheetInline('A' . $n, $oligo['name']), sheetInline('B' . $n, $oligo['sequence']), sheetInline('C' . $n, $scale), sheetInline('D' . $n, $purification));
    }
    $sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/><col min="3" max="4" width="14" customWidth="1"/></cols><sheetData>' . implode('', $rows) . '</sheetData></worksheet>';
    $path = tempnam(sys_get_temp_dir(), 'idt');
    $zip = new ZipArchive();
    if ($path === false || $zip->open($path, ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('The sheet could not be made.');
    }
    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheet);
    $zip->close();
    return $path;
}

/**
 * The upload form of Microsynth with the oligos written in its sheet "DNA Order" (rows 2 to 1153)
 *
 * @param list<array{name: string, sequence: string}> $oligos
 * @return string the path of a temporary file, to be removed by the caller
 */
function microsynthSheet(array $oligos, string $scale, string $purification): string
{
    $template = __DIR__ . '/microsynth-dna.xlsx';
    $path = tempnam(sys_get_temp_dir(), 'ms');
    if ($path === false || !@copy($template, $path)) {
        throw new RuntimeException('The sheet could not be made.');
    }
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('The sheet could not be made.');
    }
    $xml = $zip->getFromName('xl/worksheets/sheet2.xml');
    $workbook = $zip->getFromName('xl/workbook.xml');
    if ($xml === false || $workbook === false) {
        throw new RuntimeException('The form of Microsynth could not be read.');
    }
    foreach (array_slice($oligos, 0, 1152) as $index => $oligo) {
        $n = $index + 2;
        // the name and the sequence are the cells A and B, which are empty in the form
        $xml = preg_replace('/<c r="A' . $n . '"( s="\d+")?\/>/', sheetInline('A' . $n, $oligo['name'], '25'), $xml, 1) ?? $xml;
        $xml = preg_replace('/<c r="B' . $n . '"( s="\d+")?\/>/', sheetInline('B' . $n, $oligo['sequence'], '25'), $xml, 1) ?? $xml;
        // purification, scale, physical condition, datasheet and aliquots go after the length (column C)
        $cells = sheetInline('D' . $n, $purification, '19') . sheetInline('E' . $n, $scale, '25')
            . sheetInline('L' . $n, 'Dried', '19') . sheetInline('M' . $n, 'Standard', '19') . sheetInline('N' . $n, 'No', '19');
        $xml = preg_replace_callback('/(<c r="C' . $n . '"[^>]*>.*?<\/c>)/s', static fn (array $m): string => $m[1] . $cells, $xml, 1) ?? $xml;
    }
    // the cached results of the checks are empty: Excel works them out when it opens the file
    $workbook = preg_replace('/<calcPr([^>]*)\/>/', '<calcPr$1 fullCalcOnLoad="1"/>', $workbook, 1) ?? $workbook;
    $zip->addFromString('xl/worksheets/sheet2.xml', $xml);
    $zip->addFromString('xl/workbook.xml', $workbook);
    $zip->close();
    return $path;
}

/**
 * A name the form of Microsynth accepts: letters, digits and . _ + - ( ) and space, 35 characters at most
 */
function microsynthName(string $name): string
{
    return substr(preg_replace('/[^A-Za-z0-9 ._+()-]/', '_', $name) ?? $name, 0, 35);
}

function cleanOligoSequence(string $sequence): string
{
    return strtoupper(preg_replace('/[^A-Za-z]/', '', $sequence) ?? '');
}
