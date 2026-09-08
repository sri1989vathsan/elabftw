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
