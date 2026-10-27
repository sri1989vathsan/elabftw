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

use function file_exists;
use function glob;
use function is_dir;
use function mkdir;
use function preg_match;
use function rmdir;
use function sys_get_temp_dir;
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
        try {
            $id = self::parseProcurementId((new PdfParser())->parseFile($path)->getText());
            if ($id !== null) {
                return $id;
            }
        } catch (Throwable) {
            // no usable text layer: fall through to OCR
        }
        return self::parseProcurementId(self::ocr($path));
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
            $render = new Process(array(
                'gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pnggray', '-r200',
                '-dFirstPage=1', '-dLastPage=1', '-sOutputFile=' . $dir . '/page%d.png', $path,
            ));
            $render->setTimeout(90);
            $render->run();
            // TEMP-DEBUG
            @file_put_contents('/var/lib/elabftw/order-sheets/.ocr-debug', date('c') . ' gs exit=' . $render->getExitCode() . ' err=' . substr($render->getErrorOutput(), 0, 300) . ' env_path=' . (getenv('PATH') ?: '-') . ' tmp=' . $dir . "\n", FILE_APPEND);
            foreach (glob($dir . '/page*.png') ?: array() as $png) {
                $ocr = new Process(array('tesseract', $png, 'stdout', '-l', 'deu+eng', '--psm', '6'));
                $ocr->setTimeout(90);
                $ocr->run();
                // TEMP-DEBUG
                @file_put_contents('/var/lib/elabftw/order-sheets/.ocr-debug', date('c') . ' tess exit=' . $ocr->getExitCode() . ' err=' . substr($ocr->getErrorOutput(), 0, 300) . "\n", FILE_APPEND);
                if ($ocr->isSuccessful()) {
                    $text .= "\n" . $ocr->getOutput();
                }
            }
        } catch (Throwable $e) {
            @file_put_contents('/var/lib/elabftw/order-sheets/.ocr-debug', date('c') . ' EXC ' . $e->getMessage() . "\n", FILE_APPEND); // TEMP-DEBUG
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
}
