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

    /** Most recent version first. */
    public static function readAllForEntity(int $entityId): array
    {
        $Db = Db::getConnection();
        $sql = 'SELECT v.id, v.version, v.body, v.published_at,
                    CONCAT(publisher.firstname, " ", publisher.lastname) AS published_by_fullname
                FROM custom_template_versions AS v
                LEFT JOIN users AS publisher ON publisher.userid = v.published_by
                WHERE v.entity_id = :entity_id
                ORDER BY v.version DESC';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);

        return $req->fetchAll();
    }
}
