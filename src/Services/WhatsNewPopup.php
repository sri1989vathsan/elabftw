<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Elabftw\Db;
use PDO;

use function array_column;
use function array_filter;
use function array_merge;
use function array_slice;
use function array_values;
use function count;
use function date;
use function in_array;
use function is_array;
use function json_decode;
use function strtotime;

/**
 * Decides what the "What's new" popup shows a user after login. The entries are the ones of the What's new page
 * (WhatsNewStore); what a user has seen and whether they switched the popup off are kept per user, on the server,
 * in custom_user_ui_prefs (the table of the other small per-user settings).
 */
final class WhatsNewPopup
{
    public const string PREF_SEEN = 'whats-new-seen';

    public const string PREF_OFF = 'whats-new-popup-off';

    public const int MAX_FEATURED = 6;

    public const int MAX_COMPACT = 8;

    public const int FIRST_LOGIN_DAYS = 30;

    private Db $Db;

    public function __construct(private readonly int $userid, private readonly ?WhatsNewStore $Store = null)
    {
        $this->Db = Db::getConnection();
    }

    public function isEnabled(): bool
    {
        return $this->readPref(self::PREF_OFF) !== '1';
    }

    /**
     * What to show now, or an empty array when there is nothing to show.
     *
     * @return array{featured: list<array<string, mixed>>, compact: list<array<string, mixed>>, more: int, newestId: string, newestDate: string}|array{}
     */
    public function build(?int $now = null): array
    {
        if (!$this->isEnabled()) {
            return array();
        }
        $all = ($this->Store ?? new WhatsNewStore())->all();
        if ($all === array()) {
            return array();
        }
        $unseen = self::unseen($all, $this->readSeen(), $now ?? time());
        if ($unseen === array()) {
            return array();
        }
        $featured = array_values(array_filter($unseen, static fn(array $e): bool => !empty($e['featured'])));
        $others = array_values(array_filter($unseen, static fn(array $e): bool => empty($e['featured'])));
        $shownFeatured = array_slice($featured, 0, self::MAX_FEATURED);
        // when a first login shows only featured entries nothing else is offered; otherwise the rest is a compact list
        $shownCompact = array_slice($others, 0, self::MAX_COMPACT);

        return array(
            'featured' => $shownFeatured,
            'compact' => $shownCompact,
            'more' => count($unseen) - count($shownFeatured) - count($shownCompact),
            'newestId' => (string) $all[0]['id'],
            'newestDate' => (string) ($all[0]['date'] ?? ''),
        );
    }

    /**
     * How many entries the user has not seen yet (for the dot on the navbar button). Independent of the opt-out, which only
     * stops the automatic popup.
     */
    public function unseenCount(?int $now = null): int
    {
        $all = ($this->Store ?? new WhatsNewStore())->all();
        return $all === array() ? 0 : count(self::unseen($all, $this->readSeen(), $now ?? time()));
    }

    /**
     * What the navbar button shows when the user asks for it: the unseen entries first, then the most recent seen ones, up to
     * the same caps as the popup after login, newest first. Does not depend on the opt-out and never changes the seen state.
     *
     * @return array{featured: list<array<string, mixed>>, compact: list<array<string, mixed>>, more: int, newestId: string, newestDate: string, unseen: int}|array{}
     */
    public function buildOnDemand(?int $now = null): array
    {
        $all = ($this->Store ?? new WhatsNewStore())->all();
        if ($all === array()) {
            return array();
        }
        $unseen = self::unseen($all, $this->readSeen(), $now ?? time());
        $unseenIds = array_column($unseen, 'id');
        $rest = array_values(array_filter($all, static fn(array $e): bool => !in_array($e['id'], $unseenIds, true)));
        $ordered = array_merge($unseen, $rest);
        $isFeatured = static fn(array $e): bool => !empty($e['featured']);
        $featured = array_slice(array_values(array_filter($ordered, $isFeatured)), 0, self::MAX_FEATURED);
        $compact = array_slice(array_values(array_filter($ordered, static fn(array $e): bool => !$isFeatured($e))), 0, self::MAX_COMPACT);
        $shownIds = array_column(array_merge($featured, $compact), 'id');
        $unseenShown = count(array_filter($unseenIds, static fn($id): bool => in_array($id, $shownIds, true)));

        return array(
            'featured' => $featured,
            'compact' => $compact,
            'more' => count($unseen) - $unseenShown,
            'newestId' => (string) $all[0]['id'],
            'newestDate' => (string) ($all[0]['date'] ?? ''),
            'unseen' => count($unseen),
        );
    }

    /**
     * The entries newer than the last one the user saw. Entries are newest first. Without anything stored (first login)
     * only the featured entries of the last days are offered, not the whole history.
     *
     * @param array<int, array<string, mixed>> $all newest first
     * @param array{id: string, date: string}|null $seen
     * @return list<array<string, mixed>>
     */
    public static function unseen(array $all, ?array $seen, int $now): array
    {
        if ($seen === null) {
            $limit = date('Y-m-d', $now - self::FIRST_LOGIN_DAYS * 86400);
            return array_values(array_filter($all, static fn(array $e): bool => !empty($e['featured']) && (string) ($e['date'] ?? '') >= $limit));
        }
        foreach ($all as $index => $entry) {
            if (($entry['id'] ?? '') === $seen['id']) {
                return array_values(array_slice($all, 0, $index));
            }
        }
        // the entry seen was removed since: fall back to its date
        return array_values(array_filter($all, static fn(array $e): bool => (string) ($e['date'] ?? '') > $seen['date']));
    }

    /** @return array{id: string, date: string}|null */
    private function readSeen(): ?array
    {
        $raw = $this->readPref(self::PREF_SEEN);
        if ($raw === null) {
            return null;
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['id'])) {
            return null;
        }
        return array('id' => (string) $data['id'], 'date' => (string) ($data['date'] ?? ''));
    }

    private function readPref(string $key): ?string
    {
        $req = $this->Db->prepare('SELECT pref_value FROM custom_user_ui_prefs WHERE users_id = :userid AND pref_key = :key');
        $req->bindValue(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':key', $key);
        $this->Db->execute($req);
        $value = $req->fetchColumn();
        return $value === false ? null : (string) $value;
    }
}
