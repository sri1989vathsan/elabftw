<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use PDO;
use Throwable;

/**
 * Exact checks on the plasmids' attached GenBank files. No model, nothing leaves the server. Admins only.
 *
 * POST {action: annotations}                       names that mention a part (GFP, Puro ...) that the sequence file does not annotate; for known parts it is checked whether the bases are there anyway
 * POST {action: duplicates}                        plasmids whose sequence is identical but whose names differ
 * POST {action: origins}                           origin of replication x bacterial resistance; plasmids that share both cannot be kept together in one cell
 * POST {action: sites, insert, enzymes[]}          backbones that cut once with every listed enzyme, and the enzymes that also cut inside the insert
 */
require_once __DIR__ . '/app/init.inc.php';
require_once __DIR__ . '/ai-features.inc.php';

function reply(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    reply(405, array('error' => 'POST only.'));
}
if (!(bool) $App->Users->isAdmin) {
    reply(403, array('error' => 'Only an admin can do this.'));
}
if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    reply(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    reply(400, array('error' => 'Invalid request.'));
}
$action = (string) ($payload['action'] ?? '');
$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$App->Session->save();
set_time_limit(120);

const ENZYMES = array(
    'EcoRI' => 'GAATTC', 'BamHI' => 'GGATCC', 'HindIII' => 'AAGCTT', 'XhoI' => 'CTCGAG', 'NotI' => 'GCGGCCGC', 'XbaI' => 'TCTAGA', 'SpeI' => 'ACTAGT',
    'NheI' => 'GCTAGC', 'KpnI' => 'GGTACC', 'SacI' => 'GAGCTC', 'SalI' => 'GTCGAC', 'PstI' => 'CTGCAG', 'NcoI' => 'CCATGG', 'NdeI' => 'CATATG',
    'AgeI' => 'ACCGGT', 'MluI' => 'ACGCGT', 'BsrGI' => 'TGTACA', 'EcoRV' => 'GATATC', 'BglII' => 'AGATCT', 'ClaI' => 'ATCGAT', 'PacI' => 'TTAATTAA',
    'AscI' => 'GGCGCGCC', 'BsaI' => 'GGTCTC', 'BsmBI' => 'CGTCTC', 'ApaI' => 'GGGCCC', 'SmaI' => 'CCCGGG',
);

$revcomp = static fn(string $s): string => strrev(strtr($s, 'ACGT', 'TGCA'));
// how many times a site is in a sequence (both strands); a circular plasmid also has the site that spans the end
$cuts = static function (string $seq, string $site, bool $circular) use ($revcomp): int {
    $s = $circular ? $seq . substr($seq, 0, strlen($site) - 1) : $seq;
    $n = preg_match_all('/(?=' . $site . ')/', $s);
    $rc = $revcomp($site);
    if ($rc !== $site) {
        $n += preg_match_all('/(?=' . $rc . ')/', $s);
    }
    return (int) $n;
};

// the plasmids with a sequence file: id, title, Resistance field, feature names, bases (the first file of each)
$load = static function () use ($pdo, $teamId): array {
    $dir = rtrim((string) (getenv('ELAB_UPLOADS_DIR') ?: '/var/lib/elabftw/uploads'), '/');
    $req = $pdo->prepare("SELECT i.id, i.title, i.metadata, MIN(u.long_name) AS file
        FROM inventory AS i INNER JOIN inventory_categories AS c ON c.id = i.category AND c.title = 'Plasmids'
        INNER JOIN uploads AS u ON u.item_id = i.id AND u.type = 'inventory' AND u.state = 1 AND (u.real_name LIKE '%.gb' OR u.real_name LIKE '%.gbk' OR u.real_name LIKE '%.ape')
        WHERE i.team = :team AND i.state = 1 GROUP BY i.id, i.title, i.metadata ORDER BY i.id");
    $req->bindValue(':team', $teamId, PDO::PARAM_INT);
    $pdo->execute($req);
    $out = array();
    foreach ($req->fetchAll() as $row) {
        $name = (string) $row['file'];
        $path = $dir . '/' . $name;
        if (str_contains($name, '..') || !is_file($path) || filesize($path) > 8000000) {
            continue;
        }
        $text = (string) file_get_contents($path);
        $meta = json_decode((string) $row['metadata'], true);
        $resistance = is_array($meta) && is_array($meta['extra_fields']['Resistance'] ?? null) ? trim((string) ($meta['extra_fields']['Resistance']['value'] ?? '')) : '';
        $out[] = array('id' => (int) $row['id'], 'title' => (string) $row['title'], 'resistance' => $resistance, 'labels' => aiParseGenBank($text), 'seq' => aiGenBankSequence($text));
    }
    return $out;
};

try {
    if ($action === 'annotations') {
        // [part, pattern in the name, pattern in the feature names, a stretch of the usual gene that proves the part is there anyway ('' = not checked)]
        $parts = array(
            array('GFP', 'gfp', 'gfp', 'GGTGAGCAAGGGCGAGGAGCTG'),
            array('mCherry', 'mcherry', 'mcherry', ''),
            array('mScarlet', 'mscarlet', 'mscarlet', ''),
            array('BFP', 'bfp', 'bfp', 'GTGTCTAAGGGCGAAGAGCTG'),
            array('Cas9', '(?<![a-z])cas9', '(?<![a-z])(sp|sa)?cas9|dcas9', ''),
            array('Cre', '(?<![a-z])cre(?![a-z])', '(?<![a-z])(i|n)?cre(?![a-z])', ''),
            array('Puromycin resistance', 'puro', 'puro|(?<![a-z])pac(?![a-z])', 'GACCGAGTACAAGCCCACGGTG'),
            array('Hygromycin resistance', 'hygro', 'hyg', 'AAAAAGCCTGAACTCACCGCGAC'),
            array('Blasticidin resistance', 'blast', 'blast|(?<![a-z])bsd', ''),
            array('Luciferase', '(?<![a-z])luc(?![a-z])', '(?<![a-z])[fnrg]?luc', ''),
            array('TRE / Tet-On', 'tre3g|tet3g|(?<![a-z])tre(?![a-z])', 'tre|tet3g|rtta|tet-?on', ''),
            array('FLAG tag', 'flag', 'flag', 'GACTACAAGGACGACGATGACAAG'),
            array('V5 tag', '(?<![a-z0-9])v5(?![a-z0-9])', '(?<![a-z0-9])v5(?![a-z0-9])', 'GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG'),
        );
        $rows = array();
        $total = 0;
        foreach ($load() as $p) {
            $total++;
            $joined = implode(' | ', $p['labels']);
            foreach ($parts as [$name, $inName, $inFeature, $core]) {
                if (preg_match("/$inName/i", $p['title']) !== 1 || preg_match("/$inFeature/i", $joined) === 1) {
                    continue;
                }
                $status = 'not checked';
                if ($core !== '') {
                    $status = (str_contains($p['seq'], $core) || str_contains($p['seq'], $revcomp($core))) ? 'in the sequence, only not labelled' : 'not found (unconfirmed: another codon version may be used)';
                }
                $rows[] = array('id' => $p['id'], 'title' => $p['title'], 'part' => $name, 'status' => $status);
            }
        }
        reply(200, array('checked' => $total, 'rows' => $rows));
    }

    if ($action === 'duplicates') {
        $by = array();
        foreach ($load() as $p) {
            if (strlen($p['seq']) > 500) {
                $by[sha1($p['seq'])][] = array('id' => $p['id'], 'title' => $p['title']);
            }
        }
        $groups = array();
        foreach ($by as $entries) {
            $names = array();
            foreach ($entries as $e) {
                $names[preg_replace('/\W+/u', '', mb_strtolower($e['title']))] = true;
            }
            if (count($entries) > 1 && count($names) > 1) {
                $groups[] = $entries;
            }
        }
        reply(200, array('groups' => $groups));
    }

    if ($action === 'origins') {
        $combos = array();
        $total = 0;
        foreach ($load() as $p) {
            $total++;
            $labels = mb_strtolower(implode(' | ', $p['labels']));
            $ori = array();
            foreach (array('p15A' => '/p15a/', 'pSC101' => '/psc101/', 'R6K' => '/r6k/', 'pMB1 / ColE1 (pUC, pBR322)' => '/pmb1|cole1|puc ori|puc origin|pbr322|(^|\| )ori( |\||$)/') as $name => $re) {
                if (preg_match($re, $labels) === 1) {
                    $ori[] = $name;
                }
            }
            // the Resistance field of the entry when it is filled, else the feature names
            $hay = $p['resistance'] !== '' ? mb_strtolower($p['resistance']) : $labels;
            $res = array();
            foreach (array('Ampicillin' => '/amp|(?<![a-z])bla(?![a-z])|carbenicillin/', 'Kanamycin' => '/kan|(?<![a-z])neo/', 'Chloramphenicol' => '/chlor|(?<![a-z])cmr?(?![a-z])|camr|(?<![a-z])cat(?![a-z])/', 'Spectinomycin' => '/spec|aada/', 'Streptomycin' => '/strep/', 'Zeocin' => '/zeo/', 'Gentamicin' => '/gent/') as $name => $re) {
                if (preg_match($re, $hay) === 1) {
                    $res[] = $name;
                }
            }
            $key = ($ori === array() ? 'origin not annotated' : implode(' + ', $ori)) . '|' . ($res === array() ? 'none found' : implode(' + ', $res));
            $combos[$key]['n'] = ($combos[$key]['n'] ?? 0) + 1;
            if (count($combos[$key]['examples'] ?? array()) < 6) {
                $combos[$key]['examples'][] = array('id' => $p['id'], 'title' => $p['title']);
            }
        }
        uasort($combos, static fn(array $a, array $b): int => $b['n'] <=> $a['n']);
        $rows = array();
        foreach ($combos as $key => $c) {
            [$o, $r] = explode('|', $key);
            $rows[] = array('origin' => $o, 'resistance' => $r, 'count' => $c['n'], 'examples' => $c['examples']);
        }
        reply(200, array('checked' => $total, 'rows' => $rows));
    }

    if ($action === 'sites') {
        $insert = strtoupper((string) preg_replace('/[^acgtACGT]/', '', (string) preg_replace('/^>.*$/m', '', (string) ($payload['insert'] ?? ''))));
        $enzymes = array();
        foreach (is_array($payload['enzymes'] ?? null) ? $payload['enzymes'] : array() as $e) {
            if (is_string($e) && isset(ENZYMES[$e])) {
                $enzymes[] = $e;
            }
        }
        $enzymes = array_values(array_unique($enzymes));
        if (strlen($insert) < 20 || $enzymes === array()) {
            reply(400, array('error' => 'Paste the insert sequence (at least 20 bases) and choose at least one enzyme.'));
        }
        $inside = array();
        foreach ($enzymes as $e) {
            if ($cuts($insert, ENZYMES[$e], false) > 0) {
                $inside[] = $e;
            }
        }
        $backbones = array();
        $total = 0;
        foreach ($load() as $p) {
            if ($p['seq'] === '') {
                continue;
            }
            $total++;
            $ok = true;
            foreach ($enzymes as $e) {
                if ($cuts($p['seq'], ENZYMES[$e], true) !== 1) {
                    $ok = false;
                    break;
                }
            }
            if ($ok) {
                $backbones[] = array('id' => $p['id'], 'title' => $p['title'], 'length' => strlen($p['seq']));
            }
        }
        reply(200, array('checked' => $total, 'enzymes' => $enzymes, 'inside' => $inside, 'count' => count($backbones), 'backbones' => array_slice($backbones, 0, 200)));
    }

    reply(400, array('error' => 'Unknown action.'));
} catch (Throwable $e) {
    reply(500, array('error' => 'The check failed.', 'message' => $e->getMessage()));
}
