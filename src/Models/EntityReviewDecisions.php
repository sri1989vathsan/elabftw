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
 * Records the outcome of a requested review (approve/reject, with an
 * optional comment) instead of the request simply being closed with no
 * trace of the decision. One row per decision: re-submitting after a
 * rejection, or re-reviewing a later version, adds a new row rather than
 * overwriting the previous one, so the full history stays visible.
 */
final class EntityReviewDecisions
{
    public static function create(
        string $entityType,
        int $entityId,
        string $decision,
        ?string $comment,
        ?string $approvedBody,
        ?int $requestedBy,
        int $reviewedBy,
    ): int {
        $Db = Db::getConnection();
        $sql = 'INSERT INTO custom_entity_review_decisions
                (entity_type, entity_id, decision, comment, approved_body, requested_by, reviewed_by)
            VALUES (:entity_type, :entity_id, :decision, :comment, :approved_body, :requested_by, :reviewed_by)';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $req->bindValue(':decision', $decision);
        $req->bindValue(':comment', $comment);
        $req->bindValue(':approved_body', $approvedBody);
        $req->bindValue(':requested_by', $requestedBy, $requestedBy === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':reviewed_by', $reviewedBy, PDO::PARAM_INT);
        $Db->execute($req);

        return $Db->lastInsertId();
    }

    /** Most recent decision first. */
    public static function readAllForEntity(string $entityType, int $entityId): array
    {
        $Db = Db::getConnection();
        $sql = 'SELECT d.id, d.decision, d.comment, d.reviewed_at,
                    CONCAT(reviewer.firstname, " ", reviewer.lastname) AS reviewer_fullname,
                    CONCAT(requester.firstname, " ", requester.lastname) AS requester_fullname
                FROM custom_entity_review_decisions AS d
                LEFT JOIN users AS reviewer ON reviewer.userid = d.reviewed_by
                LEFT JOIN users AS requester ON requester.userid = d.requested_by
                WHERE d.entity_type = :entity_type AND d.entity_id = :entity_id
                ORDER BY d.reviewed_at DESC';
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);

        return $req->fetchAll();
    }

    /** The most recently approved body snapshot for this entity, if any. */
    public static function readApprovedBody(string $entityType, int $entityId): ?string
    {
        $Db = Db::getConnection();
        $sql = "SELECT approved_body FROM custom_entity_review_decisions
                WHERE entity_type = :entity_type AND entity_id = :entity_id AND decision = 'approved'
                ORDER BY reviewed_at DESC LIMIT 1";
        $req = $Db->prepare($sql);
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $Db->execute($req);
        $body = $req->fetchColumn();

        return $body === false ? null : (string) $body;
    }
}
