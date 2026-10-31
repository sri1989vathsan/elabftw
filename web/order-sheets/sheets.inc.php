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
use SimpleXMLElement;
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

/**
 * The oligos of an order sheet (an .xlsx file: the sheet of IDT, the form of Microsynth, or any sheet with a column of names and one
 * of sequences). The sheet "DNA Order" is read when there is one, else the first sheet. The row of the headers is the first one with a
 * column "name" and a column "sequence".
 *
 * @return list<array{name: string, sequence: string, purification: string, scale: string}>
 */
function readOrderSheet(string $path): array
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('This file is not an Excel sheet.');
    }
    $read = static function (string $name) use ($zip): ?SimpleXMLElement {
        $content = $zip->getFromName($name);
        if ($content === false) {
            return null;
        }
        $xml = simplexml_load_string($content, SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
        return $xml === false ? null : $xml;
    };
    $workbook = $read('xl/workbook.xml');
    $relations = $read('xl/_rels/workbook.xml.rels');
    if ($workbook === null || $relations === null) {
        throw new RuntimeException('This file is not an Excel sheet.');
    }
    $targets = array();
    foreach ($relations->Relationship as $relation) {
        $targets[(string) $relation['Id']] = (string) $relation['Target'];
    }
    $chosen = null;
    $workbook->registerXPathNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    foreach ($workbook->sheets->sheet as $sheet) {
        $relationId = (string) $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
        $target = $targets[$relationId] ?? null;
        if ($target === null) {
            continue;
        }
        if ($chosen === null || strtolower((string) $sheet['name']) === 'dna order') {
            $chosen = 'xl/' . ltrim(preg_replace('#^/?(xl/)?#', '', $target) ?? $target, '/');
        }
    }
    $sheetXml = $chosen === null ? null : $read($chosen);
    if ($sheetXml === null) {
        throw new RuntimeException('The sheet could not be read.');
    }
    $strings = array();
    $shared = $read('xl/sharedStrings.xml');
    if ($shared !== null) {
        foreach ($shared->si as $item) {
            $text = '';
            if (isset($item->t)) {
                $text = (string) $item->t;
            } else {
                foreach ($item->r as $run) {
                    $text .= (string) $run->t;
                }
            }
            $strings[] = $text;
        }
    }
    // the cells of each row, by the letters of their column
    $rows = array();
    foreach ($sheetXml->sheetData->row as $row) {
        $cells = array();
        foreach ($row->c as $cell) {
            $letters = preg_replace('/\d+/', '', (string) $cell['r']) ?? '';
            $type = (string) $cell['t'];
            if ($type === 's') {
                $value = $strings[(int) $cell->v] ?? '';
            } elseif ($type === 'inlineStr') {
                $value = (string) $cell->is->t;
            } else {
                $value = (string) $cell->v;
            }
            if (trim($value) !== '') {
                $cells[$letters] = trim($value);
            }
        }
        if ($cells !== array()) {
            $rows[] = $cells;
        }
        if (count($rows) > 2000) {
            break;
        }
    }
    $nameColumn = 'A';
    $sequenceColumn = 'B';
    $purificationColumn = null;
    $scaleColumn = null;
    $start = 0;
    foreach ($rows as $index => $cells) {
        $name = null;
        $sequence = null;
        foreach ($cells as $letters => $value) {
            if ($name === null && preg_match('/name/i', $value) === 1) {
                $name = $letters;
            }
            if ($sequence === null && preg_match('/sequence/i', $value) === 1) {
                $sequence = $letters;
            }
        }
        if ($name !== null && $sequence !== null) {
            $nameColumn = $name;
            $sequenceColumn = $sequence;
            foreach ($cells as $letters => $value) {
                // the exact headers (the form of Microsynth has hidden check columns with these words in their headers)
                if (preg_match('/^(dna\s+)?purification$/i', $value) === 1) {
                    $purificationColumn = $letters;
                } elseif (preg_match('/^(dna\s+)?scale$/i', $value) === 1) {
                    $scaleColumn = $letters;
                }
            }
            $start = $index + 1;
            break;
        }
    }
    $oligos = array();
    foreach (array_slice($rows, $start) as $cells) {
        $bases = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($cells[$sequenceColumn] ?? '')) ?? '');
        // a sequence: bases only (the letters of the nucleotides and of the ambiguity codes)
        if ($bases === '' || preg_match('/^[ACGTURYKMSWBDHVN]+$/', $bases) !== 1 || strlen($bases) < 8) {
            continue;
        }
        $oligos[] = array(
            'name' => (string) ($cells[$nameColumn] ?? ''),
            'sequence' => $bases,
            'purification' => $purificationColumn === null ? '' : (string) ($cells[$purificationColumn] ?? ''),
            'scale' => $scaleColumn === null ? '' : (string) ($cells[$scaleColumn] ?? ''),
        );
    }
    $zip->close();
    return $oligos;
}
