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

use RuntimeException;

use function abs;
use function array_fill;
use function chr;
use function count;
use function intdiv;
use function max;
use function min;
use function ord;
use function preg_replace;
use function str_repeat;
use function strlen;
use function strrev;
use function strtoupper;
use function strtr;
use function substr;

/**
 * Aligns a sequencing read to a reference sequence (a plasmid): finds where the read sits on the reference, on either
 * strand, then aligns it base by base with affine gaps. The whole read is aligned, the ends of the reference are free,
 * so a read covering a part of the plasmid is what it is made for.
 * The result is what the sequence editor needs: the reference and the read, both with gaps, of the same length.
 */
final class SequenceAligner
{
    private const int K = 11;

    // a k-mer shared by the read and the reference at a diagonal near this one counts for the same place
    private const int BIN = 16;

    private const int MIN_VOTES = 4;

    // how much more of the reference than the read is taken around the place found, to leave room for the gaps
    private const int MARGIN = 80;

    private const int MATCH = 5;

    private const int MISMATCH = -4;

    private const int GAP_OPEN = -10;

    private const int GAP_EXTEND = -2;

    private const int NEG = -1000000000;

    public static function clean(string $sequence): string
    {
        return preg_replace('/[^ACGTN]/', 'N', strtoupper($sequence)) ?? '';
    }

    public static function reverseComplement(string $sequence): string
    {
        return strrev(strtr($sequence, 'ACGTN', 'TGCAN'));
    }

    /**
     * @return array{strand: string, refStart: int, refEnd: int, alignedReference: string, alignedRead: string, read: string, matches: int, mismatches: array<int, array{position: int, reference: string, read: string}>, unknown: array<int, int>, insertions: array<int, int>, deletions: array<int, int>, identity: float}|null null when the read is not found on the reference
     */
    public static function align(string $reference, string $read, string $engine = ExternalAligner::BUILTIN): ?array
    {
        $reference = self::clean($reference);
        $read = self::clean($read);
        $n = strlen($reference);
        $m = strlen($read);
        if ($n < self::K || $m < self::K) {
            return null;
        }

        $index = self::indexKmers($reference);
        $best = null;
        foreach (array('+' => $read, '-' => self::reverseComplement($read)) as $strand => $oriented) {
            $found = self::findPlace($index, $oriented);
            if ($found !== null && ($best === null || $found['votes'] > $best['votes'])) {
                $best = array('strand' => $strand, 'read' => $oriented, 'diagonal' => $found['diagonal'], 'votes' => $found['votes']);
            }
        }
        if ($best === null) {
            return null;
        }

        $windowStart = max(0, $best['diagonal'] - self::MARGIN);
        $windowEnd = min($n, $best['diagonal'] + $m + self::MARGIN);
        $window = substr($reference, $windowStart, $windowEnd - $windowStart);
        // the built-in aligner, or MAFFT / Clustal Omega on the same read and the same stretch of the reference (aligner-external.inc.php)
        $aligned = $engine === ExternalAligner::BUILTIN ? self::alignToWindow($best['read'], $window) : ExternalAligner::align($engine, $best['read'], $window);
        if ($aligned === null) {
            throw new RuntimeException(ExternalAligner::label($engine) . ' did not give an alignment.');
        }

        $refStart = $windowStart + $aligned['windowStart'];
        $refEnd = $windowStart + $aligned['windowEnd'];
        // both sequences over the whole reference: the read is gaps where it does not reach
        $alignedReference = substr($reference, 0, $refStart) . $aligned['reference'] . substr($reference, $refEnd);
        $alignedRead = str_repeat('-', $refStart) . $aligned['read'] . str_repeat('-', $n - $refEnd);

        return array_merge(
            array(
                'strand' => $best['strand'],
                'refStart' => $refStart,
                'refEnd' => $refEnd,
                'alignedReference' => $alignedReference,
                'alignedRead' => $alignedRead,
                'read' => $best['read'],
            ),
            self::describe($aligned['reference'], $aligned['read'], $refStart),
        );
    }

    /**
     * @return array<string, array<int, int>>
     */
    private static function indexKmers(string $sequence): array
    {
        $index = array();
        $last = strlen($sequence) - self::K;
        for ($i = 0; $i <= $last; $i++) {
            $kmer = substr($sequence, $i, self::K);
            if (str_contains($kmer, 'N')) {
                continue;
            }
            $index[$kmer][] = $i;
        }
        return $index;
    }

    /**
     * The diagonal (position on the reference of the first base of the read) that most k-mers of the read agree on
     *
     * @param array<string, array<int, int>> $index
     * @return array{diagonal: int, votes: int}|null
     */
    private static function findPlace(array $index, string $read): ?array
    {
        $votes = array();
        $last = strlen($read) - self::K;
        for ($i = 0; $i <= $last; $i++) {
            $kmer = substr($read, $i, self::K);
            if (!isset($index[$kmer])) {
                continue;
            }
            foreach ($index[$kmer] as $position) {
                // a k-mer found in many places says little
                $bin = intdiv($position - $i + 100000000, self::BIN);
                $votes[$bin] = ($votes[$bin] ?? 0) + 1;
            }
        }
        if ($votes === array()) {
            return null;
        }
        $bestBin = array_search(max($votes), $votes, true);
        $count = $votes[$bestBin] + ($votes[$bestBin - 1] ?? 0) + ($votes[$bestBin + 1] ?? 0);
        if ($count < self::MIN_VOTES) {
            return null;
        }
        return array('diagonal' => $bestBin * self::BIN - 100000000 + intdiv(self::BIN, 2), 'votes' => $count);
    }

    /**
     * Semi-global alignment with affine gaps: all of the read, any part of the window
     *
     * @return array{reference: string, read: string, windowStart: int, windowEnd: int, score: int}
     */
    private static function alignToWindow(string $read, string $window): array
    {
        $m = strlen($read);
        $w = strlen($window);
        $width = $w + 1;
        // the way back of every cell: bits 0-1 for H (0 diagonal, 1 from E, 2 from F), bit 2 for E (extends), bit 3 for F (extends)
        $trace = str_repeat("\0", ($m + 1) * $width);

        $previousH = array_fill(0, $width, 0);
        $previousF = array_fill(0, $width, self::NEG);
        for ($i = 1; $i <= $m; $i++) {
            $currentH = array_fill(0, $width, self::NEG);
            $currentF = array_fill(0, $width, self::NEG);
            // the read cannot start before the window: its first bases are gaps
            $currentH[0] = self::GAP_OPEN + self::GAP_EXTEND * $i;
            $currentF[0] = $currentH[0];
            $e = self::NEG;
            $readBase = $read[$i - 1];
            $row = $i * $width;
            for ($j = 1; $j <= $w; $j++) {
                $refBase = $window[$j - 1];
                if ($readBase === 'N' || $refBase === 'N') {
                    $pair = 0;
                } else {
                    $pair = $readBase === $refBase ? self::MATCH : self::MISMATCH;
                }
                // E: a base of the reference without a base of the read (deletion in the read)
                $openE = $currentH[$j - 1] + self::GAP_OPEN + self::GAP_EXTEND;
                $extendE = $e + self::GAP_EXTEND;
                $eExtends = $extendE > $openE;
                $e = $eExtends ? $extendE : $openE;
                // F: a base of the read without a base of the reference (insertion in the read)
                $openF = $previousH[$j] + self::GAP_OPEN + self::GAP_EXTEND;
                $extendF = $previousF[$j] + self::GAP_EXTEND;
                $fExtends = $extendF > $openF;
                $f = $fExtends ? $extendF : $openF;
                $currentF[$j] = $f;

                $diagonal = $previousH[$j - 1] + $pair;
                $h = $diagonal;
                $from = 0;
                if ($e > $h) {
                    $h = $e;
                    $from = 1;
                }
                if ($f > $h) {
                    $h = $f;
                    $from = 2;
                }
                $currentH[$j] = $h;
                $trace[$row + $j] = chr($from | ($eExtends ? 4 : 0) | ($fExtends ? 8 : 0));
            }
            $previousH = $currentH;
            $previousF = $currentF;
        }

        // the best end on the reference
        $endJ = 0;
        $score = self::NEG;
        for ($j = 0; $j <= $w; $j++) {
            if ($previousH[$j] > $score) {
                $score = $previousH[$j];
                $endJ = $j;
            }
        }

        $alignedReference = '';
        $alignedRead = '';
        $i = $m;
        $j = $endJ;
        $state = 'H';
        while ($i > 0) {
            if ($j === 0) {
                // the rest of the read hangs before the window
                $alignedReference .= '-';
                $alignedRead .= $read[$i - 1];
                $i--;
                continue;
            }
            $cell = ord($trace[$i * $width + $j]);
            if ($state === 'H') {
                $from = $cell & 3;
                if ($from === 0) {
                    $alignedReference .= $window[$j - 1];
                    $alignedRead .= $read[$i - 1];
                    $i--;
                    $j--;
                } else {
                    $state = $from === 1 ? 'E' : 'F';
                }
            } elseif ($state === 'E') {
                $alignedReference .= $window[$j - 1];
                $alignedRead .= '-';
                $state = ($cell & 4) !== 0 ? 'E' : 'H';
                $j--;
            } else {
                $alignedReference .= '-';
                $alignedRead .= $read[$i - 1];
                $state = ($cell & 8) !== 0 ? 'F' : 'H';
                $i--;
            }
        }

        return array(
            'reference' => strrev($alignedReference),
            'read' => strrev($alignedRead),
            'windowStart' => $j,
            'windowEnd' => $endJ,
            'score' => $score,
        );
    }

    /**
     * @return array{matches: int, mismatches: array<int, array{position: int, reference: string, read: string}>, unknown: array<int, int>, insertions: array<int, int>, deletions: array<int, int>, identity: float}
     */
    private static function describe(string $reference, string $read, int $refStart): array
    {
        $matches = 0;
        $mismatches = array();
        // the bases the instrument could not call are not differences of the plasmid
        $unknown = array();
        // positions on the reference: of the bases missing in the read, and after which a base of the read has no counterpart
        $deletions = array();
        $insertions = array();
        $position = $refStart;
        $columns = strlen($reference);
        for ($c = 0; $c < $columns; $c++) {
            $r = $reference[$c];
            $q = $read[$c];
            if ($r === '-') {
                $insertions[] = $position;
                continue;
            }
            $position++;
            if ($q === '-') {
                $deletions[] = $position;
            } elseif ($q === 'N' || $r === 'N') {
                $unknown[] = $position;
            } elseif ($r === $q) {
                $matches++;
            } else {
                $mismatches[] = array('position' => $position, 'reference' => $r, 'read' => $q);
            }
        }
        $compared = $matches + count($mismatches);
        return array(
            'matches' => $matches,
            'mismatches' => $mismatches,
            'unknown' => $unknown,
            'insertions' => $insertions,
            'deletions' => $deletions,
            'identity' => $compared > 0 ? round($matches / $compared, 4) : 0.0,
        );
    }
}
