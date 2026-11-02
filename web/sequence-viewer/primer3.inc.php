<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use RuntimeException;

use function array_key_exists;
use function count;
use function file_exists;
use function fclose;
use function getenv;
use function is_resource;
use function max;
use function min;
use function preg_match;
use function proc_close;
use function proc_open;
use function round;
use function str_repeat;
use function stream_get_contents;
use function str_contains;
use function strlen;
use function explode;
use function fwrite;
use function implode;
use function stream_set_timeout;
use function substr;
use function trim;

/**
 * Primer design with Primer3 (the primer3_core program, run on the server): builds its input, runs it and gives the primer pairs
 * in the same shape as the designer of the browser (primer-design.js), so that either can fill the same panel.
 */
final class Primer3
{
    private const BINARY = '/usr/local/bin/primer3_core';

    private const CONFIG = '/usr/local/share/primer3_config/';

    private const MAX_TEMPLATE = 200000;

    /**
     * The program, when it is installed and answers. It is asked (not looked up in the file system) because PHP is not
     * allowed to look outside the folders of eLabFTW (open_basedir), where the program lives.
     */
    public static function binary(): ?string
    {
        $path = getenv('PRIMER3_CORE') ?: self::BINARY;
        $process = @proc_open(array($path, '-about'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
        if (!is_resource($process)) {
            return null;
        }
        $output = (string) stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);
        return str_contains($output, 'primer3') ? $path : null;
    }

    private static function config(): string
    {
        return getenv('PRIMER3_CONFIG') ?: self::CONFIG;
    }

    /**
     * The input of Primer3 (boulder format) for a region of the sequence.
     *
     * @param array<string, mixed> $options
     */
    public static function input(string $sequence, int $start, int $end, array $options): string
    {
        $length = strlen($sequence);
        if ($length === 0 || $length > self::MAX_TEMPLATE || preg_match('/^[ACGTN]+$/', $sequence) !== 1) {
            throw new RuntimeException('The sequence must be DNA (A, C, G, T, N) of at most ' . self::MAX_TEMPLATE . ' bases.');
        }
        if ($start < 0 || $end < $start || $end >= $length) {
            throw new RuntimeException('The region is not on the sequence.');
        }
        $size = $end - $start + 1;
        $int = static fn (string $key, int $default, int $min, int $max): int => max($min, min($max, (int) ($options[$key] ?? $default)));
        $float = static fn (string $key, float $default, float $min, float $max): float => max($min, min($max, (float) ($options[$key] ?? $default)));
        $minSize = $int('minLength', 18, 10, 35);
        $maxSize = max($minSize, $int('maxLength', 30, 10, 35));
        $tm = $float('optimalTm', 60.0, 30.0, 80.0);
        $pairs = $int('pairs', 5, 1, 20);
        $lines = array(
            'SEQUENCE_ID=design',
            'SEQUENCE_TEMPLATE=' . $sequence,
            'PRIMER_TASK=generic',
            'PRIMER_PICK_LEFT_PRIMER=1',
            'PRIMER_PICK_RIGHT_PRIMER=1',
            'PRIMER_PICK_INTERNAL_OLIGO=0',
            'PRIMER_MIN_SIZE=' . $minSize,
            'PRIMER_OPT_SIZE=' . (int) round(($minSize + $maxSize) / 2),
            'PRIMER_MAX_SIZE=' . $maxSize,
            'PRIMER_OPT_TM=' . $tm,
            'PRIMER_MIN_TM=' . ($tm - 5),
            'PRIMER_MAX_TM=' . ($tm + 5),
            'PRIMER_PAIR_MAX_DIFF_TM=5',
            'PRIMER_MIN_GC=' . $int('minGc', 40, 0, 100),
            'PRIMER_MAX_GC=' . $int('maxGc', 60, 0, 100),
            // nearest-neighbour Tm (SantaLucia) and the thermodynamic checks of hairpins and dimers
            'PRIMER_TM_FORMULA=1',
            'PRIMER_SALT_CORRECTIONS=1',
            'PRIMER_THERMODYNAMIC_OLIGO_ALIGNMENT=1',
            'PRIMER_THERMODYNAMIC_TEMPLATE_ALIGNMENT=0',
            'PRIMER_SALT_MONOVALENT=' . $float('mono', 50.0, 0.0, 500.0),
            'PRIMER_SALT_DIVALENT=' . $float('divalent', 1.5, 0.0, 50.0),
            'PRIMER_DNTP_CONC=' . $float('dntp', 0.6, 0.0, 10.0),
            'PRIMER_DNA_CONC=' . $float('dna', 250.0, 1.0, 5000.0),
            'PRIMER_NUM_RETURN=' . $pairs,
            'PRIMER_EXPLAIN_FLAG=1',
            'PRIMER_THERMODYNAMIC_PARAMETERS_PATH=' . self::config(),
        );
        if (($options['mode'] ?? 'exact') === 'flank') {
            $room = $int('flank', 100, 0, 1000);
            $lines[] = 'SEQUENCE_TARGET=' . $start . ',' . $size;
            $lines[] = 'PRIMER_PRODUCT_SIZE_RANGE=' . $size . '-' . ($size + 2 * $room);
        } else {
            // the primers sit at the two ends of the region: the 5' end of each is forced there
            $lines[] = 'SEQUENCE_FORCE_LEFT_START=' . $start;
            $lines[] = 'SEQUENCE_FORCE_RIGHT_START=' . $end;
            $lines[] = 'PRIMER_PRODUCT_SIZE_RANGE=' . $size . '-' . $size;
        }
        return implode("\n", $lines) . "\n=\n";
    }

    /**
     * Runs Primer3 on the input.
     *
     * @return array<string, string> the lines of its answer
     */
    public static function run(string $input): array
    {
        $binary = self::binary();
        if ($binary === null) {
            throw new RuntimeException('Primer3 is not installed on this server.');
        }
        $process = proc_open(array($binary), array(0 => array('pipe', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('Primer3 could not be started.');
        }
        fwrite($pipes[0], $input);
        fclose($pipes[0]);
        stream_set_timeout($pipes[1], 30);
        $output = (string) stream_get_contents($pipes[1]);
        $errors = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);
        $answer = array();
        foreach (explode("\n", $output) as $line) {
            $at = strpos($line, '=');
            if ($at > 0) {
                $answer[substr($line, 0, $at)] = substr($line, $at + 1);
            }
        }
        if (array_key_exists('PRIMER_ERROR', $answer) || array_key_exists('SEQUENCE_ERROR', $answer)) {
            throw new RuntimeException((string) ($answer['PRIMER_ERROR'] ?? $answer['SEQUENCE_ERROR']));
        }
        if ($answer === array()) {
            throw new RuntimeException('Primer3 gave no answer. ' . trim(substr($errors, 0, 200)));
        }
        return $answer;
    }

    /**
     * The pairs of the answer, in the shape of primer-design.js: {forward, reverse, product, penalty, notes}.
     *
     * @param array<string, string> $answer
     * @param array<string, mixed> $options
     * @return array{pairs: list<array<string, mixed>>, explain: string}
     */
    public static function pairs(array $answer, array $options): array
    {
        $tailForward = (string) ($options['tailForward'] ?? '');
        $tailReverse = (string) ($options['tailReverse'] ?? '');
        $count = (int) ($answer['PRIMER_PAIR_NUM_RETURNED'] ?? 0);
        $pairs = array();
        for ($i = 0; $i < $count; $i++) {
            $one = static function (string $side) use ($answer, $i): array {
                $key = 'PRIMER_' . $side . '_' . $i;
                [$from, $size] = array_map('intval', explode(',', $answer[$key] ?? '0,0'));
                // the position of a right primer is its 5' end: it covers the bases back from there
                $start = $side === 'LEFT' ? $from : $from - $size + 1;
                $notes = array();
                $hairpin = (float) ($answer[$key . '_HAIRPIN_TH'] ?? 0);
                $self = (float) ($answer[$key . '_SELF_ANY_TH'] ?? 0);
                $selfEnd = (float) ($answer[$key . '_SELF_END_TH'] ?? 0);
                $notes[] = 'hairpin Tm ' . round($hairpin, 1) . ', self-dimer Tm ' . round($self, 1) . ' (3\' end ' . round($selfEnd, 1) . ')';
                return array(
                    'sequence' => (string) ($answer[$key . '_SEQUENCE'] ?? ''),
                    'core' => (string) ($answer[$key . '_SEQUENCE'] ?? ''),
                    'start' => $start,
                    'end' => $start + $size - 1,
                    'tm' => round((float) ($answer[$key . '_TM'] ?? 0), 1),
                    'gc' => round((float) ($answer[$key . '_GC_PERCENT'] ?? 0)),
                    'notes' => $notes,
                );
            };
            $forward = $one('LEFT');
            $reverse = $one('RIGHT');
            $forward['name'] = 'F';
            $reverse['name'] = 'R';
            $forward['sequence'] = $tailForward . $forward['sequence'];
            $reverse['sequence'] = $tailReverse . $reverse['sequence'];
            $pair = 'PRIMER_PAIR_' . $i;
            $pairs[] = array(
                'forward' => $forward,
                'reverse' => $reverse,
                'product' => (int) ($answer[$pair . '_PRODUCT_SIZE'] ?? 0) + strlen($tailForward) + strlen($tailReverse),
                'penalty' => round((float) ($answer[$pair . '_PENALTY'] ?? 0), 2),
                'notes' => array(
                    'pair dimer Tm ' . round((float) ($answer[$pair . '_COMPL_ANY_TH'] ?? 0), 1) . ' (3\' end ' . round((float) ($answer[$pair . '_COMPL_END_TH'] ?? 0), 1) . ')',
                ),
            );
        }
        return array('pairs' => $pairs, 'explain' => (string) ($answer['PRIMER_PAIR_EXPLAIN'] ?? ''));
    }
}
