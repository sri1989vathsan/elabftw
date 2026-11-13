<?php

/**
 * Checks of web/sequence-viewer/genbank-primers.inc.php (no database needed). On the host there is no PHP: run it with the image,
 *   docker run --rm -v "$PWD":/w:ro --entrypoint php84 elabftw/elabimg:inventory /w/tests/manual/genbank-primers-check.php
 */

declare(strict_types=1);

require __DIR__ . '/../../web/sequence-viewer/genbank-primers.inc.php';

use Elabftw\Elabftw\GenbankPrimers;

$failures = 0;
$check = static function (string $name, bool $ok, mixed $detail = null) use (&$failures): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : ' ' . json_encode($detail)) . "\n";
    $failures += $ok ? 0 : 1;
};

// a 60-base sequence: A..T blocks so the places are easy to read
$sequence = 'ACGTTGCAAGGCTTAACCGGTTAAGCTTGGATCCAATTCGGCCATATGCGCGTAATACGA';
$forward = substr($sequence, 4, 16);   // 5..20
$reverseSite = substr($sequence, 30, 18); // 31..48, a primer on the other strand
$genbank = "LOCUS       demo 60 bp DNA circular\n"
    . "FEATURES             Location/Qualifiers\n"
    . "     source          1..60\n"
    . "                     /organism=\"synthetic\"\n"
    . "     primer_bind     5..20\n"
    . "                     /label=\"fwd demo\"\n"
    . "                     /note=\"not used, label wins\"\n"
    . "     primer_bind     complement(31..48)\n"
    . "                     /note=\"rev demo\"\n"
    . "     primer_bind     join(1..5,55..60)\n"
    . "                     /label=\"split\"\n"
    . "     primer_bind     <50..>58\n"
    . "                     /standard_name=\"long\n"
    . "                     name\"\n"
    . "     primer_bind     complement(\n"
    . "                     10..22)\n"
    . "     CDS             1..30\n"
    . "                     /label=\"not a primer\"\n"
    . "ORIGIN\n"
    . '        1 ' . strtolower(substr($sequence, 0, 10)) . ' ' . strtolower(substr($sequence, 10, 10)) . ' ' . strtolower(substr($sequence, 20, 10)) . ' ' . strtolower(substr($sequence, 30, 10)) . ' ' . strtolower(substr($sequence, 40, 10)) . ' ' . strtolower(substr($sequence, 50, 10)) . "\n"
    . "//\n";

$primers = GenbankPrimers::read($genbank);
$check('four primer_bind features are read, the join and the CDS are left out', count($primers) === 4, $primers);
$check('the forward primer has the letters of its place', ($primers[0]['bases'] ?? '') === $forward && $primers[0]['name'] === 'fwd demo' && $primers[0]['forward'] === true, $primers[0] ?? null);
$check('the primer on the other strand is the reverse complement of its place', ($primers[1]['bases'] ?? '') === GenbankPrimers::reverseComplement($reverseSite) && $primers[1]['forward'] === false, $primers[1] ?? null);
$check('the note names a primer that has no label', ($primers[1]['name'] ?? '') === 'rev demo', $primers[1] ?? null);
$check('partial markers and a name over two lines are read', ($primers[2]['start'] ?? 0) === 50 && ($primers[2]['end'] ?? 0) === 58 && ($primers[2]['name'] ?? '') === 'long name', $primers[2] ?? null);
$check('a location over two lines is read', ($primers[3]['start'] ?? 0) === 10 && ($primers[3]['end'] ?? 0) === 22 && $primers[3]['forward'] === false, $primers[3] ?? null);
$check('a primer and its reverse complement have the same key', GenbankPrimers::key($forward) === GenbankPrimers::key(GenbankPrimers::reverseComplement($forward)));
$check('different primers have different keys', GenbankPrimers::key($forward) !== GenbankPrimers::key($reverseSite));
$check('a file with no primers gives an empty list', GenbankPrimers::read("LOCUS x\nORIGIN\n        1 acgt\n//\n") === array());
$check('the reverse complement keeps ambiguity codes in pairs', GenbankPrimers::reverseComplement('ACGTRYKM') === 'KMRYACGT', GenbankPrimers::reverseComplement('ACGTRYKM'));

echo $failures === 0 ? "all passed\n" : $failures . " failed\n";
exit($failures === 0 ? 0 : 1);
