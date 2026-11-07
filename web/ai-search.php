<?php

/**
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Models\Experiments;
use Elabftw\Models\Inventory;
use Elabftw\Models\Items;
use PDO;
use Throwable;

use function array_slice;
use function count;
use function curl_close;
use function curl_exec;
use function curl_getinfo;
use function curl_init;
use function curl_setopt_array;
use function file_get_contents;
use function function_exists;
use function getenv;
use function hash_equals;
use function header;
use function html_entity_decode;
use function http_response_code;
use function in_array;
use function is_array;
use function is_numeric;
use function json_decode;
use function json_encode;
use function mb_substr;
use function pack;
use function preg_match;
use function preg_replace;
use function rtrim;
use function sha1;
use function sqrt;
use function str_starts_with;
use function strip_tags;
use function trim;
use function unpack;
use function usort;

/**
 * Search by meaning, with a language model that runs on the lab's own machines (Ollama). Nothing is sent to an outside service.
 *
 * It is OFF until a sysadmin turns it on (config ai_search_enabled), or for good when the environment has AI_SEARCH_DISABLED=1: when it is off
 * every call but "status" answers 403 and nothing talks to the model.
 *
 * GET  ?status=1                                   what is on, and how many entries are read by the model (settings are shown to sysadmins)
 * POST {action: save_settings, enabled, url, embed_model, chat_model, explain}   sysadmin only
 * POST {action: test}                              sysadmin only: asks the model for the meaning of a word
 * POST {action: reindex}                           admins: reads the next entries that are new or changed (a batch); {done} says when nothing is left
 * POST {action: search, query, types?}             anybody: the entries that fit the words, only those the person can read
 */
require_once __DIR__ . '/app/init.inc.php';

function respond(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($body);
    exit;
}

const TYPES = array('inventory', 'experiments', 'items');
const BATCH = 20;

$pdo = Db::getConnection();
$teamId = (int) $App->Users->userData['team'];
$isAdmin = (bool) $App->Users->isAdmin;
$isSysadmin = (int) ($App->Users->userData['is_sysadmin'] ?? 0) === 1;

$config = static function () use ($pdo): array {
    $req = $pdo->prepare("SELECT conf_name, conf_value FROM config WHERE conf_name LIKE 'ai_search_%'");
    $pdo->execute($req);
    $out = array();
    foreach ($req->fetchAll() as $row) {
        $out[(string) $row['conf_name']] = (string) $row['conf_value'];
    }
    return $out;
};
$settings = $config();
$forcedOff = getenv('AI_SEARCH_DISABLED') === '1';
$enabled = !$forcedOff && ($settings['ai_search_enabled'] ?? '0') === '1';
$baseUrl = rtrim(trim((string) ($settings['ai_search_url'] ?? '')), '/');
$embedModel = (string) ($settings['ai_search_embed_model'] ?? '');
$chatModel = (string) ($settings['ai_search_chat_model'] ?? '');

/** asks the local model server; returns the decoded answer, or throws a message that can be shown */
$ask = static function (string $path, array $body, int $timeout) use ($baseUrl): array {
    if (!function_exists('curl_init') || !str_starts_with($baseUrl, 'http')) {
        throw new \RuntimeException('The address of the model server is not set.');
    }
    $curl = curl_init($baseUrl . $path);
    curl_setopt_array($curl, array(
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => array('Content-Type: application/json'),
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => $timeout,
    ));
    $raw = curl_exec($curl);
    $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($raw === false || $code === 0) {
        throw new \RuntimeException('The model server does not answer. Is it running at ' . $baseUrl . '?');
    }
    $decoded = json_decode((string) $raw, true);
    if ($code >= 400 || !is_array($decoded)) {
        $why = is_array($decoded) && isset($decoded['error']) ? ' (' . (string) $decoded['error'] . ')' : '';
        throw new \RuntimeException('The model server refused the request' . $why . '.');
    }
    return $decoded;
};
/** the meaning of a text as unit-length numbers */
$embed = static function (string $text) use ($ask, $embedModel): array {
    $answer = $ask('/api/embed', array('model' => $embedModel, 'input' => $text), 60);
    $vector = $answer['embeddings'][0] ?? null;
    if (!is_array($vector) || $vector === array()) {
        throw new \RuntimeException('The model did not return a meaning for the text.');
    }
    $norm = 0.0;
    foreach ($vector as $x) {
        $norm += (float) $x * (float) $x;
    }
    $norm = $norm > 0 ? sqrt($norm) : 1.0;
    $out = array();
    foreach ($vector as $x) {
        $out[] = (float) $x / $norm;
    }
    return $out;
};

// the words of an entry that the model reads: title, tags, text and the filled fields
$textOf = static function (string $type, int $id) use ($pdo): ?array {
    $table = $type;
    $kind = $type === 'experiments' ? 'experiments' : 'items';
    $req = $pdo->prepare("SELECT title, metadata, " . ($type === 'inventory' ? "'' AS body" : 'body') . " FROM `$table` WHERE id = :id AND state = 1");
    $req->bindValue(':id', $id, PDO::PARAM_INT);
    $pdo->execute($req);
    $row = $req->fetch();
    if (!is_array($row)) {
        return null;
    }
    $tags = $pdo->prepare('SELECT tags.tag FROM tags2entity AS t INNER JOIN tags ON tags.id = t.tag_id WHERE t.item_id = :id AND t.item_type = :type');
    $tags->bindValue(':id', $id, PDO::PARAM_INT);
    $tags->bindValue(':type', $kind);
    $pdo->execute($tags);
    $tagList = $tags->fetchAll(PDO::FETCH_COLUMN);
    $fields = array();
    $meta = json_decode((string) ($row['metadata'] ?? ''), true);
    if (is_array($meta) && is_array($meta['extra_fields'] ?? null)) {
        foreach ($meta['extra_fields'] as $name => $field) {
            $value = is_array($field) ? ($field['value'] ?? '') : '';
            if (is_array($value)) {
                $value = implode(', ', $value);
            }
            if (trim((string) $value) !== '') {
                $fields[] = $name . ': ' . trim((string) $value);
            }
        }
    }
    $body = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags((string) $row['body']))));
    $title = (string) $row['title'];
    $text = mb_substr($title . '. ' . ($tagList === array() ? '' : 'Tags: ' . implode(', ', $tagList) . '. ') . implode('. ', $fields) . '. ' . $body, 0, 2400);
    return array('title' => $title, 'text' => $text);
};

// the model of an entry, to ask whether the person can read it (same rules as the rest of the application)
$canRead = static function (string $type, int $id) use ($App): bool {
    try {
        $entity = match ($type) {
            'experiments' => new Experiments($App->Users, $id),
            'items' => new Items($App->Users, $id),
            default => new Inventory($App->Users, $id),
        };
        $entity->readOne();
        return true;
    } catch (Throwable) {
        return false;
    }
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    $counts = array();
    foreach (TYPES as $type) {
        $req = $pdo->prepare("SELECT COUNT(*) FROM `$type` WHERE team = :team AND state = 1");
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $pdo->execute($req);
        $done = $pdo->prepare('SELECT COUNT(*) FROM ai_search_index WHERE team = :team AND entity_type = :type');
        $done->bindValue(':team', $teamId, PDO::PARAM_INT);
        $done->bindValue(':type', $type);
        $pdo->execute($done);
        $counts[$type] = array('entries' => (int) $req->fetchColumn(), 'indexed' => (int) $done->fetchColumn());
    }
    respond(200, array(
        'enabled' => $enabled,
        'forced_off' => $forcedOff,
        'explain' => $enabled && ($settings['ai_search_explain'] ?? '0') === '1',
        'counts' => $counts,
        'settings' => $isSysadmin ? array(
            'enabled' => ($settings['ai_search_enabled'] ?? '0') === '1',
            'url' => $baseUrl,
            'embed_model' => $embedModel,
            'chat_model' => $chatModel,
            'explain' => ($settings['ai_search_explain'] ?? '0') === '1',
        ) : null,
    ));
}

if (!hash_equals((string) $App->Session->get('csrf'), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    respond(403, array('error' => 'Invalid token.'));
}
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    respond(400, array('error' => 'Invalid request.'));
}
$action = (string) ($payload['action'] ?? '');

if ($action === 'save_settings') {
    if (!$isSysadmin) {
        respond(403, array('error' => 'Only a sysadmin can change this.'));
    }
    $url = rtrim(trim((string) ($payload['url'] ?? '')), '/');
    if ($url !== '' && preg_match('#^https?://[^\s]+$#', $url) !== 1) {
        respond(400, array('error' => 'The address must start with http:// or https://'));
    }
    $values = array(
        'ai_search_enabled' => !empty($payload['enabled']) ? '1' : '0',
        'ai_search_url' => $url,
        'ai_search_embed_model' => mb_substr(trim((string) ($payload['embed_model'] ?? '')), 0, 100),
        'ai_search_chat_model' => mb_substr(trim((string) ($payload['chat_model'] ?? '')), 0, 100),
        'ai_search_explain' => !empty($payload['explain']) ? '1' : '0',
    );
    $write = $pdo->prepare('UPDATE config SET conf_value = :value WHERE conf_name = :name');
    foreach ($values as $name => $value) {
        $write->bindValue(':value', $value);
        $write->bindValue(':name', $name);
        $pdo->execute($write);
    }
    respond(200, array('saved' => true, 'enabled' => $values['ai_search_enabled'] === '1' && !$forcedOff));
}

if (!$enabled) {
    respond(403, array('error' => 'disabled', 'message' => 'The search by meaning is turned off.'));
}

try {
    if ($action === 'test') {
        if (!$isSysadmin) {
            respond(403, array('error' => 'Only a sysadmin can do this.'));
        }
        $vector = $embed('plasmid');
        respond(200, array('ok' => true, 'dims' => count($vector)));
    }

    if ($action === 'reindex') {
        if (!$isAdmin) {
            respond(403, array('error' => 'Only an admin can do this.'));
        }
        $done = 0;
        $skipped = 0;
        foreach (TYPES as $type) {
            // the entries that are not read yet come first, then the ones whose text changed (found by the hash while reading)
            $req = $pdo->prepare("SELECT e.id, i.content_hash, i.model FROM `$type` AS e LEFT JOIN ai_search_index AS i ON i.entity_type = :type AND i.entity_id = e.id
                WHERE e.team = :team AND e.state = 1 AND (i.entity_id IS NULL OR i.model <> :model OR i.indexed_at < e.modified_at) ORDER BY i.entity_id IS NULL DESC, e.id LIMIT " . (BATCH - $done));
            $req->bindValue(':type', $type);
            $req->bindValue(':model', $embedModel);
            $req->bindValue(':team', $teamId, PDO::PARAM_INT);
            $pdo->execute($req);
            foreach ($req->fetchAll() as $row) {
                $entry = $textOf($type, (int) $row['id']);
                if ($entry === null) {
                    continue;
                }
                $hash = sha1($entry['text']);
                if ((string) $row['content_hash'] === $hash && (string) $row['model'] === $embedModel) {
                    // same words, same model: only the date moves, so it is not looked at again
                    $touch = $pdo->prepare('UPDATE ai_search_index SET indexed_at = NOW() WHERE entity_type = :type AND entity_id = :id');
                    $touch->bindValue(':type', $type);
                    $touch->bindValue(':id', (int) $row['id'], PDO::PARAM_INT);
                    $pdo->execute($touch);
                    $skipped++;
                    continue;
                }
                $vector = $embed($entry['text']);
                $put = $pdo->prepare('REPLACE INTO ai_search_index (entity_type, entity_id, team, content_hash, model, title, snippet, dims, vec) VALUES (:type, :id, :team, :hash, :model, :title, :snippet, :dims, :vec)');
                $put->bindValue(':type', $type);
                $put->bindValue(':id', (int) $row['id'], PDO::PARAM_INT);
                $put->bindValue(':team', $teamId, PDO::PARAM_INT);
                $put->bindValue(':hash', $hash);
                $put->bindValue(':model', $embedModel);
                $put->bindValue(':title', mb_substr($entry['title'], 0, 255));
                $put->bindValue(':snippet', mb_substr($entry['text'], 0, 600));
                $put->bindValue(':dims', count($vector), PDO::PARAM_INT);
                $put->bindValue(':vec', pack('g*', ...$vector), PDO::PARAM_LOB);
                $pdo->execute($put);
                $done++;
                if ($done >= BATCH) {
                    break 2;
                }
            }
        }
        respond(200, array('indexed' => $done, 'skipped' => $skipped, 'done' => $done === 0 && $skipped === 0));
    }

    if ($action === 'search') {
        $query = trim((string) ($payload['query'] ?? ''));
        if ($query === '') {
            respond(400, array('error' => 'Write what you are looking for.'));
        }
        $types = array();
        foreach (is_array($payload['types'] ?? null) ? $payload['types'] : TYPES as $type) {
            if (in_array($type, TYPES, true)) {
                $types[] = $type;
            }
        }
        if ($types === array()) {
            $types = TYPES;
        }
        $limit = max(1, min(30, (int) ($payload['limit'] ?? 10)));
        $q = $embed(mb_substr($query, 0, 2000));
        $dims = count($q);
        $scored = array();
        $req = $pdo->prepare('SELECT entity_type, entity_id, title, snippet, vec FROM ai_search_index WHERE team = :team AND dims = :dims');
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $req->bindValue(':dims', $dims, PDO::PARAM_INT);
        $pdo->execute($req);
        while ($row = $req->fetch()) {
            if (!in_array($row['entity_type'], $types, true)) {
                continue;
            }
            $v = unpack('g*', (string) $row['vec']);
            $dot = 0.0;
            for ($i = 0; $i < $dims; $i++) {
                $dot += $q[$i] * $v[$i + 1];
            }
            $scored[] = array('type' => (string) $row['entity_type'], 'id' => (int) $row['entity_id'], 'title' => (string) $row['title'], 'snippet' => (string) $row['snippet'], 'score' => round($dot, 4));
        }
        usort($scored, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
        // only what the person can read is shown: the first candidates are asked, not all of them
        $hits = array();
        foreach (array_slice($scored, 0, $limit * 4) as $candidate) {
            if ($canRead($candidate['type'], $candidate['id'])) {
                $candidate['url'] = ($candidate['type'] === 'experiments' ? 'experiments.php' : ($candidate['type'] === 'items' ? 'database.php' : 'registry.php')) . '?mode=view&id=' . $candidate['id'];
                $hits[] = $candidate;
            }
            if (count($hits) >= $limit) {
                break;
            }
        }
        $explanation = null;
        if (($settings['ai_search_explain'] ?? '0') === '1' && $chatModel !== '' && $hits !== array()) {
            $lines = '';
            foreach (array_slice($hits, 0, 8) as $n => $hit) {
                $lines .= ($n + 1) . '. ' . $hit['title'] . ' - ' . mb_substr($hit['snippet'], 0, 300) . "\n";
            }
            try {
                $answer = $ask('/api/chat', array('model' => $chatModel, 'stream' => false, 'messages' => array(
                    array('role' => 'system', 'content' => 'You help a scientist find items in the lab database. Use only the listed entries. For each one that fits the request, say in one short sentence why. Name the number and title. If none fits, say so. Do not invent anything.'),
                    array('role' => 'user', 'content' => "Request: $query\n\nEntries:\n$lines"),
                )), 120);
                $explanation = trim((string) ($answer['message']['content'] ?? ''));
            } catch (Throwable $e) {
                $explanation = null;
            }
        }
        respond(200, array('hits' => $hits, 'explanation' => $explanation, 'searched' => count($scored)));
    }
} catch (\RuntimeException $e) {
    respond(502, array('error' => $e->getMessage()));
}

respond(400, array('error' => 'Unknown action.'));
