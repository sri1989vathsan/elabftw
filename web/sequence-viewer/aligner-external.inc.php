<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use function array_merge;
use function fclose;
use function file_put_contents;
use function fread;
use function fwrite;
use function is_resource;
use function is_string;
use function microtime;
use function preg_match;
use function preg_split;
use function preg_replace;
use function proc_close;
use function proc_get_status;
use function proc_open;
use function proc_terminate;
use function str_starts_with;
use function stream_get_contents;
use function stream_set_blocking;
use function strlen;
use function strtoupper;
use function substr;
use function substr_count;
use function sys_get_temp_dir;
use function tempnam;
use function trim;
use function unlink;
use function usleep;

/**
 * Fork-only. Aligns a read to a stretch of the reference with MAFFT or Clustal Omega, the two programs built into the image
 * (containers/elabimg/Dockerfile). SequenceAligner finds the strand and the place of the read, this file does the base by base alignment of
 * the read and that stretch, and gives it back in the form SequenceAligner::alignToWindow gives it.
 * The programs are started without a shell, with arguments that never come from the request, and are stopped after a time limit.
 */
final class ExternalAligner
{
    public const string BUILTIN = 'builtin';

    private const int TIME_LIMIT = 60;

    /** name => path of the program, its label and its arguments (the fasta file with the two sequences is added) */
    private const array ENGINES = array(
        'mafft' => array('path' => '/usr/local/bin/mafft', 'label' => 'MAFFT', 'args' => array('--quiet', '--auto', '--thread', '1')),
        'clustalo' => array('path' => '/usr/local/bin/clustalo', 'label' => 'Clustal Omega', 'args' => array('--force', '--seqtype=DNA', '--outfmt=fa', '--threads=1')),
    );

    /** the name of an algorithm that can be asked for: the built-in one or a program of the image; null for anything else */
    public static function normalize(mixed $engine): ?string
    {
        if ($engine === null || $engine === '' || $engine === self::BUILTIN) {
            return self::BUILTIN;
        }
        return is_string($engine) && isset(self::ENGINES[$engine]) ? $engine : null;
    }

    public static function label(string $engine): string
    {
        return self::ENGINES[$engine]['label'] ?? 'the built-in aligner';
    }

    /** the program of the image starts and says its version (is_executable cannot be used: open_basedir keeps PHP out of /usr/local/bin, a started program is not affected) */
    public static function isAvailable(string $engine): bool
    {
        if ($engine === self::BUILTIN) {
            return true;
        }
        if (!isset(self::ENGINES[$engine])) {
            return false;
        }
        static $known = array();
        if (!isset($known[$engine])) {
            $process = @proc_open(array(self::ENGINES[$engine]['path'], '--version'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
            $said = '';
            if (is_resource($process)) {
                $said = (string) stream_get_contents($pipes[1]) . (string) stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
            }
            $known[$engine] = preg_match('/\d+\.\d+/', $said) === 1;
        }
        return $known[$engine];
    }

    /**
     * Aligns the read to the window of the reference; both are cleaned (A, C, G, T, N). The columns before the first base of the read and
     * after its last one are left out, as SequenceAligner does: the answer says where the read starts and ends in the window.
     *
     * @return array{reference: string, read: string, windowStart: int, windowEnd: int}|null null when the program failed
     */
    public static function align(string $engine, string $read, string $window): ?array
    {
        if (!isset(self::ENGINES[$engine]) || !self::isAvailable($engine) || $read === '' || $window === '') {
            return null;
        }
        $fasta = ">reference\n" . $window . "\n>read\n" . $read . "\n";
        $input = tempnam(sys_get_temp_dir(), 'aln');
        if ($input === false) {
            return null;
        }
        try {
            if (file_put_contents($input, $fasta) === false) {
                return null;
            }
            $output = self::run($engine, $input);
        } finally {
            @unlink($input);
        }
        if ($output === null) {
            return null;
        }
        $sequences = self::parseFasta($output);
        if (!isset($sequences['reference'], $sequences['read']) || strlen($sequences['reference']) !== strlen($sequences['read'])) {
            return null;
        }
        $reference = $sequences['reference'];
        $aligned = $sequences['read'];
        // the first and the last column where the read has a base
        $first = null;
        $last = null;
        $columns = strlen($aligned);
        for ($c = 0; $c < $columns; $c++) {
            if ($aligned[$c] !== '-') {
                $first ??= $c;
                $last = $c;
            }
        }
        if ($first === null || $last === null) {
            return null;
        }
        $reference = substr($reference, $first, $last - $first + 1);
        $aligned = substr($aligned, $first, $last - $first + 1);
        $windowStart = $first - substr_count(substr($sequences['reference'], 0, $first), '-');
        $windowEnd = $windowStart + strlen($reference) - substr_count($reference, '-');
        // the bases of the read must be the ones that were sent: a program that changed them is not trusted
        if (preg_replace('/-/', '', $aligned) !== $read || preg_replace('/-/', '', $sequences['reference']) !== $window) {
            return null;
        }
        return array('reference' => $reference, 'read' => $aligned, 'windowStart' => $windowStart, 'windowEnd' => $windowEnd);
    }

    /** the alignment as the program wrote it, or null when it failed or took too long */
    private static function run(string $engine, string $input): ?string
    {
        $spec = self::ENGINES[$engine];
        $command = array($spec['path']);
        if ($engine === 'clustalo') {
            $command = array_merge($command, $spec['args'], array('-i', $input, '-o', '/dev/stdout'));
        } else {
            $command = array_merge($command, $spec['args'], array($input));
        }
        $process = proc_open(
            $command,
            array(0 => array('pipe', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w')),
            $pipes,
            sys_get_temp_dir(),
            array('PATH' => '/usr/local/bin:/usr/bin:/bin', 'TMPDIR' => sys_get_temp_dir()),
        );
        if (!is_resource($process)) {
            return null;
        }
        // nothing is sent to the program, and what it says on its error output is read and dropped (open_basedir keeps PHP from /dev/null)
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $output = '';
        $started = microtime(true);
        $timedOut = false;
        while (true) {
            fread($pipes[2], 65536);
            $chunk = fread($pipes[1], 65536);
            if ($chunk !== false && $chunk !== '') {
                $output .= $chunk;
                continue;
            }
            if (!proc_get_status($process)['running']) {
                // what is left in the pipe
                $output .= (string) fread($pipes[1], 1048576);
                break;
            }
            if (microtime(true) - $started > self::TIME_LIMIT) {
                $timedOut = true;
                proc_terminate($process, 9);
                break;
            }
            usleep(10000);
        }
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($process);
        return $timedOut || $output === '' || ($code !== 0 && $code !== -1) ? null : $output;
    }

    /** @return array<string, string> the sequences by name, in capitals */
    private static function parseFasta(string $text): array
    {
        $sequences = array();
        $name = null;
        foreach (preg_split('/\r?\n/', $text) ?: array() as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (str_starts_with($line, '>')) {
                $name = trim(substr($line, 1));
                $sequences[$name] = '';
            } elseif ($name !== null) {
                $sequences[$name] .= strtoupper($line);
            }
        }
        return $sequences;
    }
}
