<?php
/**
 * Renders made-up sheets with the real mPDF and PdfBodyPrep, to look at the pages (pdf-matches-live, landscape, split):
 *
 *   docker exec -i <web> php -r 'eval("?>".$argv[1]); eval("?>".stream_get_contents(STDIN));' -- "$(sed '/^declare(strict_types/d' src/Make/PdfBodyPrep.php)" < tests/manual/pdf-render.php > out.b64
 *
 * Environment: SHEET=sample|c4|c30|long  MODE=landscape|fit|split. Prints the PDF base64 encoded on stdout (nothing is written in the container).
 */
require '/elabftw/vendor/autoload.php';

use Elabftw\Make\PdfBodyPrep;

$sheet = getenv('SHEET') ?: 'sample';
$mode = getenv('MODE') ?: 'landscape';
$names = array('pUC19-AmpR-GFP-NLS-3xFLAG', 'pET28a-His6-TEV-mCherry-linker', 'pcDNA3.1(+)-HA-Cas9-T2A-Puro', 'pLKO.1-shRNA-scramble-control', 'pGEX-6P-1-GST-PreScission', 'pX330-U6-Chimeric_BB-CBh-hSpCas9', 'pCMV-VSV-G-envelope', 'pCAG-Cre-IRES-Neo', 'pRSET-B-6xHis-EGFP', 'pENTR-D-TOPO-donor');
$col = static fn(int $i): string => chr(65 + $i);
$build = static function (int $cols, int $rows, int $filled, int $width, bool $long) use ($names, $col): string {
    $colgroup = '<col style="width:42px">' . str_repeat('<col style="width:' . $width . 'px">', $cols);
    $head = '<th class="spreadsheet-coordinate" style="width:42px;"></th>' . implode('', array_map(static fn(int $i): string => '<th class="spreadsheet-coordinate">' . ($i < 26 ? chr(65 + $i) : 'A' . chr(65 + $i - 26)) . '</th>', range(0, $cols - 1)));
    $body = '';
    for ($r = 0; $r < $rows; $r++) {
        $cells = '';
        for ($c = 0; $c < $cols; $c++) {
            $st = 'border:1px solid #ced4da;padding:8px;height:33px;';
            $v = '';
            if ($r < $filled && $c < $cols - 1) {
                $v = $long ? $names[($r + $c) % 10] : 'v' . $r . $c;
                if ($r === 0) { $st .= 'font-weight:bold;background-color:#ffcc00;'; }
                elseif ($c === 1) { $st .= 'text-align:right;'; $v = number_format($r * 1.5, 2); }
                elseif ($c === 2) { $st .= 'background-color:#99ccff;'; }
            }
            $cells .= '<td style="' . $st . '">' . $v . '</td>';
        }
        $body .= '<tr style="height:33px"><th class="spreadsheet-coordinate">' . ($r + 1) . '</th>' . $cells . '</tr>';
    }
    return '<table class="elabftw-spreadsheet" style="width:100%"><colgroup>' . $colgroup . '</colgroup><thead><tr>' . $head . '</tr></thead><tbody>' . $body . '</tbody></table>';
};
$tables = array(
    'sample' => $build(8, 14, 10, 190, true),   // 7 data columns + an empty one, rows 11-14 empty
    'c4' => $build(5, 6, 6, 100, false),        // 4 data columns
    'c30' => $build(31, 8, 8, 100, false),
    'long' => $build(5, 150, 150, 100, false),
);
$mpdf = new \Mpdf\Mpdf(array('format' => 'A4', 'margin_left' => 10, 'margin_right' => 10, 'margin_top' => 10, 'margin_bottom' => 10, 'tempDir' => '/run/elabftw/tmp'));
$page = $mpdf->pgwidth * 96 / 25.4;
$land = ($mpdf->pgwidth + $mpdf->h - $mpdf->w) * 96 / 25.4;
$html = '<h2>Plasmids</h2><p>Before the sheet.</p>' . PdfBodyPrep::spreadsheets($tables[$sheet], $page, $mode, $land) . '<h2>After</h2><p>Text after the sheet, back on a portrait page.</p>';
$mpdf->WriteHTML('<style>body{font-family:sans-serif;font-size:10pt} table{font-size:9pt}</style>' . $html);
echo base64_encode($mpdf->OutputBinaryData());
