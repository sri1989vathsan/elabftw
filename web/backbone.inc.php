<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\Action;
use Elabftw\Models\Inventory;
use PDO;
use Throwable;

use function array_flip;
use function array_key_first;
use function array_intersect_key;
use function array_keys;
use function array_search;
use function arsort;
use function array_slice;
use function array_sum;
use function count;
use function crc32;
use function file_get_contents;
use function file_put_contents;
use function filesize;
use function getenv;
use function is_array;
use function is_file;
use function json_decode;
use function json_encode;
use function preg_match;
use function preg_replace;
use function md5;
use function min;
use function pack;
use function reset;
use function rename;
use function round;
use function rtrim;
use function serialize;
use function sort;
use function str_contains;
use function strlen;
use function strrev;
use function str_starts_with;
use function strtolower;
use function strtoupper;
use function strtr;
use function substr;
use function sys_get_temp_dir;
use function trim;
use function uasort;
use function uniqid;
use function unpack;
use function unserialize;

/**
 * Finds the backbone of a plasmid from its sequence alone, by what the lab already knows: the plasmids of the Plasmids module that have a
 * sequence file AND a Backbone written in by a person (one that fill() made is marked and not used).
 *
 * The backbone is the Backbone name whose plasmids share most with the new sequence AMONG THEMSELVES: what only one plasmid of a name has
 * is its insert, and is not counted. (Comparing with the single closest plasmid goes wrong: two plasmids with the same insert in two
 * different backbones look like twins.) Names with fewer than two plasmids with a file are not used.
 *
 * Nothing leaves the server. Needs aiGenBankSequence() of ai-features.inc.php.
 */
final class Backbone
{
    /** length of the words that are compared */
    private const K = 14;

    /** one word in SAMPLE is kept (keeps the index small); the same words are kept in every sequence */
    private const SAMPLE = 3;

    /** a name needs at least this many plasmids with a sequence file to be used */
    private const MIN_PLASMIDS = 2;

    /** a word belongs to the backbone of a name when at least this many of its plasmids have it */
    private const MIN_SUPPORT = 2;

    /** names of the family of the best name that explain at least this part of what the best explains compete for the name (the one with most plasmids wins) */
    private const FAMILY_PART = 0.85;

    /** least part of the sequence that the best name must explain before it is given */
    public const MIN_SCORE = 0.25;

    /** the best name must explain this many times more than the next name */
    public const MIN_LEAD = 1.3;

    /** what was worked out for this request (a long import is not slowed down by every new plasmid): [labels, vocabulary] */
    private ?array $memo = null;

    public function __construct(private PDO|Db $pdo, private int $team)
    {
    }

    /** the Backbone of the plasmids that have one and what their sequences share, worked out once per object */
    private function state(): array
    {
        if ($this->memo === null) {
            $labels = $this->labels();
            $refs = $this->references($labels);
            $this->memo = array($labels, $refs, $this->vocabulary($refs, $labels));
        }
        return $this->memo;
    }

    /** two names are of one family when one starts with the other (not told apart by capitals) */
    public static function related(string $a, string $b): bool
    {
        $a = strtolower($a);
        $b = strtolower($b);
        return str_starts_with($a, $b) || str_starts_with($b, $a);
    }

    /** the words of a sequence: sorted list of integers, the same for a sequence and its reverse complement; a circular one also has the words over the end */
    public static function words(string $seq): array
    {
        $seq = strtoupper($seq);
        if (strlen($seq) < self::K + 20) {
            return array();
        }
        $seq .= substr($seq, 0, self::K - 1);
        $n = strlen($seq);
        $rc = strrev(strtr($seq, 'ACGT', 'TGCA'));
        $out = array();
        for ($i = 0; $i <= $n - self::K; $i++) {
            $a = crc32(substr($seq, $i, self::K));
            $b = crc32(substr($rc, $n - self::K - $i, self::K));
            $h = $a < $b ? $a : $b;
            if ($h % self::SAMPLE === 0) {
                $out[$h] = true;
            }
        }
        $words = array_keys($out);
        sort($words);
        return $words;
    }

    private function cacheFile(string $name): string
    {
        return sys_get_temp_dir() . '/elab-backbone-' . $name . '-' . $this->team . '.ser';
    }

    /**
     * What was kept before: the file of the temporary folder (quick), else the table backbone_cache (it survives a restart of the container; its
     * content is put back in the file). Without the table everything still works, only a restart costs a new reading of the files.
     */
    private function readCache(string $name, string $key): ?array
    {
        $file = $this->cacheFile($name);
        if (is_file($file)) {
            $stored = @unserialize((string) file_get_contents($file), array('allowed_classes' => false));
            if (is_array($stored) && ($stored['key'] ?? '') === $key) {
                return $stored['data'];
            }
        }
        try {
            $req = $this->pdo->prepare('SELECT ckey, data FROM backbone_cache WHERE team = :team AND name = :name');
            $req->bindValue(':team', $this->team, PDO::PARAM_INT);
            $req->bindValue(':name', $name);
            $req->execute();
            $row = $req->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable) {
            return null;
        }
        if (!is_array($row) || $row['ckey'] !== $key) {
            return null;
        }
        $data = @unserialize((string) $row['data'], array('allowed_classes' => false));
        if (!is_array($data)) {
            return null;
        }
        $this->writeFile($name, $key, $data);
        return $data;
    }

    private function writeFile(string $name, string $key, array $data): void
    {
        $file = $this->cacheFile($name);
        $tmp = $file . '.' . uniqid('', true);
        if (@file_put_contents($tmp, serialize(array('key' => $key, 'data' => $data))) !== false) {
            @rename($tmp, $file);
        }
    }

    private function writeCache(string $name, string $key, array $data): void
    {
        $this->writeFile($name, $key, $data);
        try {
            $req = $this->pdo->prepare('REPLACE INTO backbone_cache (team, name, ckey, data) VALUES (:team, :name, :ckey, :data)');
            $req->bindValue(':team', $this->team, PDO::PARAM_INT);
            $req->bindValue(':name', $name);
            $req->bindValue(':ckey', $key);
            $req->bindValue(':data', serialize($data), PDO::PARAM_LOB);
            $req->execute();
        } catch (Throwable) {
            // the table is not there yet, or the packet is too large: the file alone is kept, as before
        }
    }

    /**
     * The words of every plasmid that has a Backbone written in AND a sequence file: [entry id => packed words]. The words of a file are kept
     * (in a file of the server, by upload) so that only a new or replaced sequence file is read; a plasmid without a Backbone is not needed.
     */
    private function references(array $labels): array
    {
        $dir = rtrim((string) (getenv('ELAB_UPLOADS_DIR') ?: '/var/lib/elabftw/uploads'), '/');
        $req = $this->pdo->prepare("SELECT i.id, MIN(u.id) AS upload, MIN(u.long_name) AS file
            FROM inventory AS i INNER JOIN inventory_categories AS c ON c.id = i.category AND c.title = 'Plasmids'
            INNER JOIN uploads AS u ON u.item_id = i.id AND u.type = 'inventory' AND u.state = 1 AND (u.real_name LIKE '%.gb' OR u.real_name LIKE '%.gbk' OR u.real_name LIKE '%.ape')
            WHERE i.team = :team AND i.state = 1 GROUP BY i.id ORDER BY i.id");
        $req->bindValue(':team', $this->team, PDO::PARAM_INT);
        $req->execute();
        $known = $this->readCache('words', 'v1') ?? array();
        $before = array_keys($known);
        $kept = array();
        $refs = array();
        foreach ($req->fetchAll() as $row) {
            $id = (int) $row['id'];
            $upload = (int) $row['upload'];
            if (!isset($labels[$id])) {
                continue;
            }
            if (!isset($known[$upload])) {
                $name = (string) $row['file'];
                $path = $dir . '/' . $name;
                if (str_contains($name, '..') || !is_file($path) || filesize($path) > 8000000) {
                    continue;
                }
                $words = self::words(aiGenBankSequence((string) file_get_contents($path)));
                $known[$upload] = $words ? pack('V*', ...$words) : '';
            }
            $kept[$upload] = $known[$upload];
            if ($kept[$upload] !== '') {
                $refs[$id] = $kept[$upload];
            }
        }
        if (array_keys($kept) !== $before) {
            $this->writeCache('words', 'v1', $kept);
        }
        return $refs;
    }

    /** the Backbone written in the plasmids that have one: [entry id => backbone] */
    private function labels(): array
    {
        $req = $this->pdo->prepare("SELECT i.id, i.metadata FROM inventory AS i INNER JOIN inventory_categories AS c ON c.id = i.category AND c.title = 'Plasmids'
            WHERE i.team = :team AND i.state = 1 ORDER BY i.id");
        $req->bindValue(':team', $this->team, PDO::PARAM_INT);
        $req->execute();
        $out = array();
        foreach ($req->fetchAll() as $row) {
            $meta = json_decode((string) $row['metadata'], true);
            $field = is_array($meta) && is_array($meta['extra_fields']['Backbone'] ?? null) ? $meta['extra_fields']['Backbone'] : array();
            $value = trim((string) ($field['value'] ?? ''));
            // a Backbone that the computer filled in (fill()) is a guess: it is not a reference for the next ones
            if ($value !== '' && (string) ($field['auto'] ?? '') !== $value) {
                $out[(int) $row['id']] = $value;
            }
        }
        return $out;
    }

    /**
     * What each name's plasmids share: ['words' => [word => [name number => how many of its plasmids have the word]], 'names' => [number => name],
     * 'plasmids' => [number => how many plasmids]]. Names with fewer than MIN_PLASMIDS plasmids with a file are left out. Kept in a file until
     * a sequence file or a Backbone changes.
     */
    private function vocabulary(array $refs, array $labels): array
    {
        $key = md5(serialize(array_keys($refs)) . serialize(array_intersect_key($labels, $refs)));
        $cached = $this->readCache('vocabulary', $key);
        if ($cached !== null) {
            return $cached;
        }
        $byName = array();
        foreach ($labels as $id => $name) {
            if (isset($refs[$id])) {
                $byName[$name][] = $id;
            }
        }
        $words = array();
        $names = array();
        $plasmids = array();
        foreach ($byName as $name => $ids) {
            if (count($ids) < self::MIN_PLASMIDS) {
                continue;
            }
            $number = count($names);
            $names[$number] = (string) $name;
            $plasmids[$number] = count($ids);
            $count = array();
            foreach ($ids as $id) {
                foreach (unpack('V*', $refs[$id]) as $w) {
                    $count[$w] = ($count[$w] ?? 0) + 1;
                }
            }
            // a word that only one plasmid of the name has is its insert, not its backbone: it is not kept
            foreach ($count as $w => $c) {
                if ($c >= self::MIN_SUPPORT) {
                    $words[$w][$number] = min($c, 65535);
                }
            }
        }
        $out = array('words' => $words, 'names' => $names, 'plasmids' => $plasmids);
        $this->writeCache('vocabulary', $key, $out);
        return $out;
    }

    /**
     * The backbone of a sequence: ['backbone' => name or '', 'score' => the score of that name, 'lead' => its score divided by the next name's,
     * 'candidates' => the best names [['backbone', 'score', 'plasmids' (how many it is made from)]]].
     * The score of a name is the part of the sequence that its plasmids have in common among them (their backbone, not their inserts); a part
     * that many names have (origin, resistance gene) counts little, a part that only this name has counts fully, a part that no name has (the
     * insert of the sequence) counts against all names equally.
     * $skip = a plasmid that is not counted (the plasmid itself, to test).
     */
    public function find(string $seq, ?int $skip = null): array
    {
        $none = array('backbone' => '', 'score' => 0.0, 'lead' => 0.0, 'candidates' => array());
        $query = self::words($seq);
        if (!$query) {
            return $none;
        }
        [$labels, $refs, $vocabulary] = $this->state();
        // the plasmid that is tested is taken out of its name: the words only it (and one other) has are not shared any more
        $own = null;
        if ($skip !== null && isset($labels[$skip], $refs[$skip])) {
            $own = array_search($labels[$skip], $vocabulary['names'], true);
            $own = $own === false ? null : $own;
        }
        $total = 0.0;
        $got = array();
        foreach ($query as $w) {
            $names = array();
            foreach ($vocabulary['words'][$w] ?? array() as $number => $c) {
                if ($number === $own) {
                    $c--;
                }
                if ($c >= self::MIN_SUPPORT) {
                    $names[] = $number;
                }
            }
            if (!$names) {
                $total += 1.0;
                continue;
            }
            $weight = 1.0 / count($names);
            $total += $weight;
            foreach ($names as $number) {
                $got[$number] = ($got[$number] ?? 0.0) + $weight;
            }
        }
        if (!$got) {
            return $none;
        }
        $score = array();
        foreach ($got as $number => $sum) {
            $score[$number] = $sum / $total;
        }
        arsort($score);
        $list = array();
        foreach (array_slice($score, 0, 5, true) as $number => $value) {
            $list[] = array('backbone' => $vocabulary['names'][$number], 'score' => round($value, 3), 'plasmids' => $vocabulary['plasmids'][$number]);
        }
        // the lab's names are nested (pT4, pT4-U6-sgRNA-CMV-EGFP): names that start with one another are one family, not rivals. Of the family
        // of the best name, the one with most plasmids is given; the lead is over the best name outside the family.
        $top = $list[0];
        $family = array();
        $rival = 0.0;
        foreach ($score as $number => $value) {
            $name = $vocabulary['names'][$number];
            if (self::related($name, $top['backbone'])) {
                if ($value >= self::FAMILY_PART * $top['score']) {
                    $family[$number] = $vocabulary['plasmids'][$number];
                }
            } elseif ($rival === 0.0) {
                $rival = $value;
            }
        }
        arsort($family);
        $chosen = $vocabulary['names'][(int) array_key_first($family)];
        $lead = $rival > 0 ? $top['score'] / $rival : 99.0;
        $ok = $top['score'] >= self::MIN_SCORE && $lead >= self::MIN_LEAD;
        return array('backbone' => $ok ? $chosen : '', 'chosen' => $chosen, 'score' => $top['score'], 'lead' => round($lead, 2), 'candidates' => $list);
    }

    /** the bases of a GenBank or FASTA file's text, upper case; '' when it has none */
    public static function sequenceOf(string $text): string
    {
        if (preg_match('/^\s*>/', $text) === 1) {
            return strtoupper((string) preg_replace('/[^ACGTNacgtn]/', '', (string) preg_replace('/^>.*$/m', '', $text)));
        }
        return aiGenBankSequence($text);
    }

    /**
     * Fills the Backbone field of a plasmid when it is empty and the sequence is clear enough about it ($Entry null: written straight to the database, for an admin). Never changes a Backbone that is there.
     * Returns ['filled' => bool, 'backbone' => name found (also when not filled: the best guess), 'score', 'reason' => why not, '' when filled].
     */
    public function fill(?Inventory $Entry, int $entryId, string $sequenceFile): array
    {
        $out = array('filled' => false, 'backbone' => '', 'score' => 0.0, 'reason' => '');
        $req = $this->pdo->prepare('SELECT i.metadata, c.title FROM inventory AS i INNER JOIN inventory_categories AS c ON c.id = i.category WHERE i.id = :id AND i.team = :team');
        $req->bindValue(':id', $entryId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->team, PDO::PARAM_INT);
        $req->execute();
        $row = $req->fetch();
        if (!is_array($row) || $row['title'] !== 'Plasmids') {
            $out['reason'] = 'It is not a plasmid.';
            return $out;
        }
        $meta = json_decode((string) $row['metadata'], true);
        $fields = is_array($meta) && is_array($meta['extra_fields'] ?? null) ? $meta['extra_fields'] : array();
        $key = null;
        foreach ($fields as $name => $field) {
            if (is_array($field) && preg_match('/^backbone$/i', (string) $name) === 1) {
                $key = $name;
                break;
            }
        }
        if ($key === null) {
            $out['reason'] = 'The module has no Backbone field.';
            return $out;
        }
        if (trim((string) ($fields[$key]['value'] ?? '')) !== '') {
            $out['reason'] = 'There is a Backbone already.';
            return $out;
        }
        $found = $this->find(self::sequenceOf($sequenceFile));
        $out['backbone'] = (string) ($found['chosen'] ?? '');
        $out['score'] = (float) $found['score'];
        if ($found['backbone'] === '') {
            $out['reason'] = $out['backbone'] === '' ? 'No backbone of the lab is known well enough to compare.' : 'No backbone is clear enough (the closest is ' . $out['backbone'] . ').';
            return $out;
        }
        $fields[$key]['value'] = $found['backbone'];
        // marked as made by the computer: such a Backbone is not used as a reference later (a wrong guess would teach the next ones)
        // (the marker is the guess itself: a person who changes the value makes it a reference again)
        $fields[$key]['auto'] = $found['backbone'];
        $meta['extra_fields'] = $fields;
        $json = json_encode($meta, JSON_UNESCAPED_UNICODE);
        if ($Entry !== null) {
            $Entry->patch(Action::Update, array('metadata' => $json));
        } else {
            // for the admin who fills many plasmids of other people at once (the entry model only lets owners and the entry's editors write)
            $set = $this->pdo->prepare('UPDATE inventory SET metadata = :metadata WHERE id = :id AND team = :team');
            $set->bindValue(':metadata', $json);
            $set->bindValue(':id', $entryId, PDO::PARAM_INT);
            $set->bindValue(':team', $this->team, PDO::PARAM_INT);
            $set->execute();
        }
        $out['filled'] = true;
        return $out;
    }
}
