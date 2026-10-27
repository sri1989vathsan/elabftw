<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Services;

use Smalot\PdfParser\Parser as PdfParser;
use Symfony\Component\Process\Process;
use Throwable;

use function array_column;
use function file_exists;
use function glob;
use function is_dir;
use function mb_strtoupper;
use function mkdir;
use function preg_match;
use function rmdir;
use function sys_get_temp_dir;
use function trim;
use function uniqid;
use function unlink;

/**
 * Reads the procurement number of a shop sheet ("Rüstschein 26048470") from a PDF. The sheets the shop sends back are
 * scans (images only), so the text layer is tried first and OCR (Ghostscript to an image, then Tesseract) after it.
 */
final class ScanReader
{
    public static function procurementIdFromPdf(string $path): ?string
    {
        return self::parseProcurementId(self::textFromPdf($path, true));
    }

    /**
     * The text of a PDF: its text layer, or OCR when there is none. With $untilIdFound the OCR is skipped when the
     * text layer already holds a procurement number.
     */
    public static function textFromPdf(string $path, bool $untilIdFound = false): string
    {
        $text = '';
        try {
            $text = (new PdfParser())->parseFile($path)->getText();
            if ($text !== '' && ($untilIdFound ? self::parseProcurementId($text) !== null : true) && preg_match('/\d{4}/', $text) === 1) {
                return $text;
            }
        } catch (Throwable) {
            // no usable text layer: fall through to OCR
        }
        return $text . "\n" . self::ocr($path);
    }

    /**
     * Article numbers found in the text of a sheet: a run of letters, digits and dashes with at least one digit and
     * at least five characters (HPA029397-100U, E2758-1G). Upper case, for comparison with the confirmation.
     *
     * @return list<string>
     */
    public static function articleTokens(string $text): array
    {
        preg_match_all('/(?<![A-Z0-9\-])([A-Z0-9][A-Z0-9\-]{4,})(?![A-Z0-9\-])/u', mb_strtoupper($text), $matches);
        return array_values(array_unique(array_filter($matches[1], static fn (string $token): bool => preg_match('/\d/', $token) === 1)));
    }

    /** The number after "Rüstschein", tolerant of the way OCR misreads the ü and the spacing. */
    public static function parseProcurementId(string $text): ?string
    {
        if (preg_match('/R\S{0,2}st\s?schein\W{0,4}(\d{6,10})/iu', $text, $matches) === 1
            || preg_match('/schein\W{0,4}(\d{7,10})/iu', $text, $matches) === 1
        ) {
            return $matches[1];
        }
        return null;
    }

    private static function ocr(string $path): string
    {
        $dir = sys_get_temp_dir() . '/' . uniqid('sheet_', true);
        if (!mkdir($dir, 0700, true) && !is_dir($dir)) {
            return '';
        }
        $text = '';
        try {
            // an explicit working directory: a scheduled run inherits one that may no longer exist
            $render = new Process(array(
                'gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pnggray', '-r300',
                '-dFirstPage=1', '-dLastPage=1', '-sOutputFile=' . $dir . '/page%d.png', $path,
            ), $dir);
            $render->setTimeout(90);
            $render->run();
            foreach (glob($dir . '/page*.png') ?: array() as $png) {
                // Two reading modes, their text joined: line by line (6) keeps a row together, sparse text (11) reads
                // numbers sitting between the table's rules that the first one skips or garbles.
                foreach (array('6', '11') as $mode) {
                    $ocr = new Process(array('tesseract', $png, 'stdout', '-l', 'deu+eng', '--psm', $mode), $dir);
                    $ocr->setTimeout(90);
                    $ocr->run();
                    if ($ocr->isSuccessful()) {
                        $text .= "\n" . $ocr->getOutput();
                    }
                }
            }
        } catch (Throwable) {
            // the tools are missing or failed: the caller treats "no number" as unreadable
        } finally {
            foreach (glob($dir . '/*') ?: array() as $file) {
                if (file_exists($file)) {
                    unlink($file);
                }
            }
            rmdir($dir);
        }
        return $text;
    }

    /**
     * The basket ("Warenkorb") of a procurement confirmation: one entry per item row, the row's text with the
     * whitespace removed and in upper case (the confirmation wraps long article numbers), to compare with the article
     * numbers read from a collection sheet.
     */
    /** @return list<string> */
    public static function basketItems(string $confirmationText): array
    {
        return array_column(self::basketRows($confirmationText), 'key');
    }

    /**
     * The same rows with a readable label for each (supplier, article number and description as printed).
     *
     * @return list<array{key: string, label: string}>
     */
    public static function basketRows(string $confirmationText): array
    {
        if (preg_match('/Warenkorb(.*)$/su', $confirmationText, $basket) !== 1) {
            return array();
        }
        $text = $basket[1];
        // the header row ends with "Gesamtpreis"; the items follow
        if (preg_match('/Gesamtpreis/u', $text, $header, PREG_OFFSET_CAPTURE) === 1) {
            $text = substr($text, $header[0][1] + 11);
        }
        // every item row ends with its quantity, unit price and total price, whatever the unit: "1each 400,51CHF1 each 400.51", "2.000Piece 699,41CHF 1 Piece 1,398.81"
        if (preg_match_all('/[\d.,]+\s*[A-Za-z]+\s*[\d.,\x{2019}\']+\s*[A-Z]{3}\s*\d+\s*[A-Za-z]+\s+[\d.,\x{2019}\']+/u', $text, $rows, PREG_OFFSET_CAPTURE) === 0) {
            return array();
        }
        $items = array();
        $start = 0;
        foreach ($rows[0] as [$row, $offset]) {
            $end = $offset + strlen($row);
            $chunk = substr($text, $start, $end - $start);
            $label = trim((string) preg_replace('/\s+/u', ' ', substr($chunk, 0, strlen($chunk) - strlen($row))));
            $items[] = array(
                'key' => mb_strtoupper((string) preg_replace('/\s+/u', '', $chunk)),
                'label' => $label !== '' ? $label : trim((string) preg_replace('/\s+/u', ' ', $chunk)),
            );
            $start = $end;
        }
        return $items;
    }
}
