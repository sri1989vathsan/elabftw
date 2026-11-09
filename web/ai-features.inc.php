<?php

/**
 * Parts of a plasmid (GFP, puromycin resistance, a promoter ...) for the search by meaning. Fork-only file, used by ai-search.php.
 *
 * The parts come from the feature names inside the attached sequence files (GenBank .gb / .gbk / .ape), so "contains puromycin" is answered from the
 * sequence and not from what someone wrote in a note. The list of parts and the patterns that recognise them are in ai-features.json.
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use function file_get_contents;
use function in_array;
use function is_array;
use function json_decode;
use function mb_strtolower;
use function mb_substr;
use function preg_match;
use function preg_replace;
use function str_replace;
use function strpos;
use function strtolower;
use function substr;
use function trim;
use function array_values;
use function array_unique;
use function explode;
use function implode;

/** the vocabulary: [{name, group, label, query, text}] with the three patterns ready to use */
function aiFeatureVocab(): array
{
    static $vocab = null;
    if ($vocab !== null) {
        return $vocab;
    }
    $vocab = array();
    $json = json_decode((string) @file_get_contents(__DIR__ . '/ai-features.json'), true);
    foreach (is_array($json['features'] ?? null) ? $json['features'] : array() as $f) {
        if (!is_array($f) || !isset($f['name'])) {
            continue;
        }
        $make = static fn(string $p): string => '/' . str_replace('/', '\/', $p) . '/iu';
        $vocab[(string) $f['name']] = array(
            'name' => (string) $f['name'],
            'group' => (string) ($f['group'] ?? ''),
            'label' => $make((string) ($f['label'] ?? $f['re'] ?? '$^')),
            'query' => $make((string) ($f['query'] ?? $f['re'] ?? '$^')),
            'text' => $make((string) ($f['re'] ?? $f['query'] ?? '$^')),
        );
    }
    return $vocab;
}

/** the parts found in a text: $kind is 'label' (feature names of a sequence), 'query' (words of a question) or 'text' (the text of an entry); $only limits the names that are tested */
function aiFeaturesIn(string $hay, string $kind, ?array $only = null): array
{
    $found = array();
    foreach (aiFeatureVocab() as $name => $f) {
        if ($only !== null && !in_array($name, $only, true)) {
            continue;
        }
        if (preg_match($f[$kind], $hay) === 1) {
            $found[] = $name;
        }
    }
    return $found;
}

/** the names of the features of a GenBank file (primers and the source line are left out); no other part of the file is read */
function aiParseGenBank(string $text): array
{
    $skip = array('source', 'primer_bind', 'gap');
    $labels = array();
    $key = null;
    $cur = array();
    $q = null;
    $flush = static function () use (&$labels, &$key, &$cur, $skip): void {
        if ($key !== null && !in_array(strtolower($key), $skip, true)) {
            $v = trim((string) ($cur['label'] ?? $cur['gene'] ?? $cur['product'] ?? ''), " \t\"");
            if ($v !== '') {
                $labels[] = mb_substr(str_replace('\\', ' ', $v), 0, 60);
            }
        }
    };
    $inside = false;
    foreach (explode("\n", str_replace("\r", '', $text)) as $line) {
        if (!$inside) {
            $inside = strpos($line, 'FEATURES') === 0;
            continue;
        }
        if (strpos($line, 'ORIGIN') === 0 || strpos($line, 'CONTIG') === 0) {
            break;
        }
        if (preg_match('/^ {5}(\S+)\s+\S/', $line, $m) === 1) {
            $flush();
            $key = $m[1];
            $cur = array();
            $q = null;
            continue;
        }
        if (substr($line, 0, 21) === '                     ') {
            $s = trim($line);
            if ($s !== '' && $s[0] === '/') {
                if (preg_match('/^\/(\w+)=?(.*)$/', $s, $mm) === 1) {
                    $q = $mm[1];
                    $cur[$q] = $cur[$q] ?? $mm[2];
                }
            } elseif ($q !== null) {
                $cur[$q] = ($cur[$q] ?? '') . ' ' . $s;
            }
        }
    }
    $flush();
    return array_values(array_unique($labels));
}

/** which module a question is about: the first of plasmid / antibody / cell words it uses ("a plasmid for mammalian cells" is about plasmids); null when none */
function aiModuleIntent(string $query): ?string
{
    $q = mb_strtolower($query);
    foreach (array(
        'Plasmids' => '/plasmid|vector|construct|backbone/u',
        'Antibodies' => '/antibod|(?<![a-z])ab(?![a-z])/u',
        'Cells & strains' => '/cell line|cells|organoid|strain/u',
    ) as $module => $pattern) {
        if (preg_match($pattern, $q) === 1) {
            return $module;
        }
    }
    return null;
}

/** the bases of a GenBank file (the ORIGIN part), upper case, without numbers and spaces; '' when the file has none */
function aiGenBankSequence(string $text): string
{
    $at = strpos($text, "\nORIGIN");
    if ($at === false) {
        return '';
    }
    $end = strpos($text, "\n//", $at);
    $part = substr($text, $at + 7, $end === false ? null : $end - $at - 7);
    return strtoupper((string) preg_replace('/[^acgtnACGTN]/', '', $part));
}
