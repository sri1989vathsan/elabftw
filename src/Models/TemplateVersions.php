<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use PDO;

/**
 * A permanent snapshot of a template's body each time "Publish new version"
 * is used (see the Action::PublishVersion branch in AbstractEntity::patch()).
 * The version column on experiments_templates is only a counter; this is
 * where the actual content at each version number lives.
 */
final class TemplateVersions
{
    public static function create(int $entityId, int $version, string $body, int $publishedBy): int
    {
        $Db = Db::getConnection();
        $sql = 'INSERT INTO custom_template_versions
                (entity_id, version, body, published_by)
            VALUES (:entity_id, :version, :body, :published_by)';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $req->bindValue(':version', $version, PDO::PARAM_INT);
        $req->bindValue(':body', $body);
        $req->bindValue(':published_by', $publishedBy, PDO::PARAM_INT);
        $Db->execute($req);

        return $Db->lastInsertId();
    }

    /**
     * Most recent version first. published_at/published_by_fullname are
     * also exposed aliased as created_at/fullname, matching the field names
     * revisions.html already expects from the (unrelated) core Revisions
     * model -- lets the "Template versions" page reuse that template with
     * minimal changes.
     */
    public static function readAllForEntity(int $entityId): array
    {
        self::backfillVersion1IfMissing($entityId);
        $Db = Db::getConnection();
        $sql = 'SELECT v.id, v.version, v.body, v.published_at, v.published_at AS created_at,
                    CONCAT(publisher.firstname, " ", publisher.lastname) AS published_by_fullname,
                    CONCAT(publisher.firstname, " ", publisher.lastname) AS fullname
                FROM custom_template_versions AS v
                LEFT JOIN users AS publisher ON publisher.userid = v.published_by
                WHERE v.entity_id = :entity_id
                ORDER BY v.version DESC';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);

        return $req->fetchAll();
    }

    /**
     * The next number "Publish new version" should use -- always one past
     * the highest version number that has ever existed for this entity, not
     * one past whatever the entity's own (possibly restored-backward)
     * current version counter says. Restoring to an earlier version leaves
     * later ones (e.g. 3 and 4) sitting in history untouched -- publishing
     * again from version 2 must not try to recreate version 3 and collide
     * with the unique (entity_id, version) constraint on the one already
     * there, so it jumps straight to 5 instead.
     */
    public static function readMaxVersion(int $entityId): int
    {
        $Db = Db::getConnection();
        $sql = 'SELECT MAX(version) FROM custom_template_versions WHERE entity_id = :entity_id';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);

        return (int) $req->fetchColumn();
    }

    /**
     * Buckets the ordinary auto-saved revisions (from the core Revisions
     * model -- a completely separate system, see this class's own top
     * comment) under whichever published version was current while each one
     * was made, so a published version's own row can show (and restore to)
     * the intermediate edits that led up to it, not just its own one
     * all-or-nothing snapshot. A revision belongs to the *earliest* version
     * whose own published_at is still at or after it, i.e. the first
     * publish it was absorbed into -- checked oldest-version-first
     * regardless of the order either argument arrives in (sorted into a
     * local copy below), since checking newest-first would instead match
     * every old revision against the newest version's own published_at
     * (always satisfied by anything older), dumping the entire history
     * into one bucket. A revision newer than every version's own
     * published_at is draft work made since the last publish, not yet
     * claimed by any version -- instead of being hidden entirely, it is
     * attached to the entity's own *current* version (by number, via
     * $currentVersion), as the in-progress edit history leading up to
     * whatever gets published next. That is ordinarily also the
     * highest-numbered version, but not after a restore to an earlier one:
     * versions published after the one just restored to (e.g. 3 and 4,
     * restored back to 2) are left untouched in history, so new draft work
     * belongs under 2 -- the one actually being worked on -- not under 4,
     * an abandoned future branch nobody is editing anymore. Falls back to
     * the highest-numbered version if $currentVersion doesn't match any
     * ($versions may not be in sync with the entity's own row in a caller
     * that doesn't pass it).
     *
     * @param list<array{id: int, version: int, published_at: string}> $versions
     * @param list<array{id: int, created_at: string}> $revisions
     * @return array<int, list<array<string, mixed>>> revisions keyed by version id
     */
    public static function bucketRevisionsByVersion(array $versions, array $revisions, ?int $currentVersion = null): array
    {
        $oldestFirst = $versions;
        usort($oldestFirst, static fn(array $a, array $b): int => $a['version'] <=> $b['version']);

        $buckets = array();
        foreach ($oldestFirst as $version) {
            $buckets[$version['id']] = array();
        }
        if (count($oldestFirst) === 0) {
            return $buckets;
        }
        $currentVersionRow = $currentVersion !== null
            ? array_values(array_filter($oldestFirst, static fn(array $v): bool => $v['version'] === $currentVersion))
            : array();
        $unclaimedBucketId = $currentVersionRow !== array() ? $currentVersionRow[0]['id'] : end($oldestFirst)['id'];
        foreach ($revisions as $revision) {
            $claimed = false;
            foreach ($oldestFirst as $version) {
                if ($revision['created_at'] <= $version['published_at']) {
                    $buckets[$version['id']][] = $revision;
                    $claimed = true;
                    break;
                }
            }
            if (!$claimed) {
                $buckets[$unclaimedBucketId][] = $revision;
            }
        }
        return $buckets;
    }

    /**
     * Templates::create() now records v1 immediately, but templates created
     * before that fix (or by any other path that skipped it) never got a
     * permanent v1 snapshot -- "Publish new version" only ever snapshots the
     * *new* version, never the one being published from. Self-heals on next
     * read: the true original v1 body is unrecoverable once a template has
     * moved on (its content was never captured separately), so this seeds v1
     * with the oldest snapshot we do have as the closest available proxy, or
     * the template's current body if no snapshot exists at all yet.
     */
    private static function backfillVersion1IfMissing(int $entityId): void
    {
        $Db = Db::getConnection();
        $sql = 'SELECT 1 FROM custom_template_versions WHERE entity_id = :entity_id AND version = 1';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);
        if ($req->fetchColumn() !== false) {
            return;
        }

        $sql = 'SELECT body, published_by FROM custom_template_versions
            WHERE entity_id = :entity_id ORDER BY version ASC LIMIT 1';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);
        $oldest = $req->fetch(PDO::FETCH_ASSOC);
        if ($oldest !== false) {
            self::create($entityId, 1, (string) $oldest['body'], (int) $oldest['published_by']);
            return;
        }

        $sql = 'SELECT body, userid FROM experiments_templates WHERE id = :id';
        $req = $Db->prepare($sql);
        $req->bindValue(':id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);
        $current = $req->fetch(PDO::FETCH_ASSOC);
        if ($current !== false) {
            self::create($entityId, 1, (string) ($current['body'] ?? ''), (int) $current['userid']);
        }
    }
}
