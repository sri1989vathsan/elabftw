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

use function preg_match;
use function preg_replace;
use function preg_split;
use function str_starts_with;
use function strcmp;
use function strlen;
use function strtolower;
use function strrev;
use function strtoupper;
use function strtr;
use function substr;
use function trim;

/**
 * Fork-only. The primers written in a GenBank file (the features of the type primer_bind, as Benchling writes them), with their
 * letters as the primer is ordered (the reverse complement for a primer on the other strand). Used by the import of a module with
 * sequence files, to attach the primers that are in the database (by their letters) and, if asked, to make the ones that are missing.
 */
final class GenbankPrimers
{
    /** the shortest primer that is looked for (the primers tab of the sequence editor uses the same) */
    public const int MIN_LENGTH = 12;

    /** the names a feature can carry its name in, the first one found is used */
    private const array NAME_QUALIFIERS = array('label', 'standard_name', 'note', 'gene', 'name');

    /**
     * @return list<array{name: string, start: int, end: int, forward: bool, bases: string}> positions are 1-based, end included;
     *                                                                                      features with a split location (join) are left out
     */
    public static function read(string $genbank): array
    {
        $sequence = '';
        $features = array();
        $current = null;
        $inFeatures = false;
        $inOrigin = false;
        foreach (preg_split('/\r\n|\r|\n/', $genbank) ?: array() as $line) {
            if (str_starts_with($line, '//')) {
                break;
            }
            if (str_starts_with($line, 'FEATURES')) {
                $inFeatures = true;
                $inOrigin = false;
                continue;
            }
            if (str_starts_with($line, 'ORIGIN')) {
                if ($current !== null) {
                    $features[] = $current;
                    $current = null;
                }
                $inFeatures = false;
                $inOrigin = true;
                continue;
            }
            if ($inOrigin) {
                $sequence .= (string) preg_replace('/[^A-Za-z]/', '', $line);
                continue;
            }
            if (!$inFeatures) {
                continue;
            }
            if (preg_match('/^ {1,8}(\S+)\s+(\S.*)$/', $line, $m) === 1 && !str_starts_with(trim($line), '/')) {
                // a new feature: its key and the start of its location (which can go on in the next lines)
                if ($current !== null) {
                    $features[] = $current;
                }
                $current = array('key' => $m[1], 'location' => trim($m[2]), 'qualifiers' => array(), 'last' => null, 'locationOpen' => true);
                continue;
            }
            if ($current === null || preg_match('/^ {10,}(\S.*)$/', $line, $m) !== 1) {
                continue;
            }
            $text = trim($m[1]);
            if (str_starts_with($text, '/')) {
                $current['locationOpen'] = false;
                if (preg_match('/^\/([A-Za-z_]+)(?:=(.*))?$/', $text, $q) === 1) {
                    $current['last'] = $q[1];
                    // only the first value of a qualifier is kept
                    if (!isset($current['qualifiers'][$q[1]])) {
                        $current['qualifiers'][$q[1]] = $q[2] ?? '';
                    } else {
                        $current['last'] = null;
                    }
                }
            } elseif ($current['locationOpen']) {
                $current['location'] .= $text;
            } elseif ($current['last'] !== null) {
                $current['qualifiers'][$current['last']] .= ' ' . $text;
            }
        }
        if ($current !== null) {
            $features[] = $current;
        }

        $sequence = strtoupper($sequence);
        $primers = array();
        foreach ($features as $feature) {
            if (strtolower($feature['key']) !== 'primer_bind') {
                continue;
            }
            $location = $feature['location'];
            $forward = true;
            if (preg_match('/^complement\((.*)\)$/', $location, $c) === 1) {
                $forward = false;
                $location = $c[1];
            }
            if (preg_match('/^[<>]?(\d+)\.\.[<>]?(\d+)$/', $location, $m) !== 1) {
                continue;
            }
            $start = (int) $m[1];
            $end = (int) $m[2];
            if ($start < 1 || $end < $start || $end > strlen($sequence)) {
                continue;
            }
            $bases = substr($sequence, $start - 1, $end - $start + 1);
            if (!$forward) {
                $bases = self::reverseComplement($bases);
            }
            $primers[] = array('name' => self::nameOf($feature['qualifiers']), 'start' => $start, 'end' => $end, 'forward' => $forward, 'bases' => $bases);
        }
        return $primers;
    }

    /** the letters of a sequence, upper case, nothing else */
    public static function clean(string $bases): string
    {
        return strtoupper((string) preg_replace('/[^A-Za-z]/', '', $bases));
    }

    public static function reverseComplement(string $bases): string
    {
        return strrev(strtr(self::clean($bases), 'ACGTURYKMBVDH', 'TGCAAYRMKVBHD'));
    }

    /** the same key for a primer and for its reverse complement: two primers with this key are the same oligo */
    public static function key(string $bases): string
    {
        $clean = self::clean($bases);
        $reverse = self::reverseComplement($clean);
        return strcmp($clean, $reverse) <= 0 ? $clean : $reverse;
    }

    /** @param array<string, string> $qualifiers */
    private static function nameOf(array $qualifiers): string
    {
        foreach (self::NAME_QUALIFIERS as $key) {
            $value = trim((string) ($qualifiers[$key] ?? ''), " \t\"");
            if ($value !== '') {
                return $value;
            }
        }
        return 'primer';
    }
}
