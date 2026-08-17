<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Users\Users;
use PDO;

use function in_array;
use function mb_substr;
use function trim;

/** Store only eLabFTW↔PyRAT identifiers; entity details stay in PyRAT. */
final class PyratLinks
{
    private Db $Db;

    public function __construct(private Users $requester)
    {
        $this->Db = Db::getConnection();
    }

    /** @return list<array<string, mixed>> */
    public function readForExperiment(int $experimentId): array
    {
        $this->assertExperimentAccess($experimentId, AccessType::Read);
        $sql = 'SELECT l.id, l.experiment_id, l.entity_type, l.pyrat_entity_id, l.pyrat_label,
                l.linked_by, l.created_at,
                TRIM(CONCAT(u.firstname, " ", u.lastname)) AS linked_by_name
            FROM pyrat_experiment_links AS l
            LEFT JOIN users AS u ON (u.userid = l.linked_by)
            WHERE l.experiment_id = :experiment_id
            ORDER BY l.entity_type, l.pyrat_label, l.pyrat_entity_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':experiment_id', $experimentId, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    public function link(int $experimentId, string $entityType, string $entityId, ?string $label = null): int
    {
        $this->assertExperimentAccess($experimentId, AccessType::Write);
        $entityType = $this->validateEntityType($entityType);
        $entityId = trim($entityId);
        if ($entityId === '') {
            throw new ImproperActionException('Missing PyRAT entity identifier.');
        }
        $entityId = mb_substr($entityId, 0, 128);
        $label = trim((string) $label);
        $label = $label === '' ? null : mb_substr($label, 0, 255);

        $sql = 'INSERT INTO pyrat_experiment_links
                (experiment_id, entity_type, pyrat_entity_id, pyrat_label, linked_by)
            VALUES (:experiment_id, :entity_type, :entity_id, :label, :linked_by)
            ON DUPLICATE KEY UPDATE
                pyrat_label = VALUES(pyrat_label), linked_by = VALUES(linked_by)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':experiment_id', $experimentId, PDO::PARAM_INT);
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':entity_id', $entityId);
        $req->bindValue(':label', $label);
        $req->bindValue(':linked_by', $this->requester->getUserid(), PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    public function unlink(int $experimentId, string $entityType, string $entityId): bool
    {
        $this->assertExperimentAccess($experimentId, AccessType::Write);
        $sql = 'DELETE FROM pyrat_experiment_links
            WHERE experiment_id = :experiment_id AND entity_type = :entity_type AND pyrat_entity_id = :entity_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':experiment_id', $experimentId, PDO::PARAM_INT);
        $req->bindValue(':entity_type', $this->validateEntityType($entityType));
        $req->bindValue(':entity_id', trim($entityId));
        return $this->Db->execute($req);
    }

    /** @return list<array<string, mixed>> */
    public function readAccessible(): array
    {
        $sql = 'SELECT l.experiment_id, l.entity_type, l.pyrat_entity_id, l.pyrat_label, l.created_at
            FROM pyrat_experiment_links AS l
            INNER JOIN experiments AS e ON (e.id = l.experiment_id)
            WHERE e.team = :team
            ORDER BY l.created_at DESC
            LIMIT 500';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $result = array();
        foreach ($req->fetchAll() as $row) {
            try {
                $experiment = new Experiments($this->requester, (int) $row['experiment_id']);
                $data = $experiment->readOne();
            } catch (\Throwable) {
                continue;
            }
            $row['experiment_title'] = $data['title'];
            $result[] = $row;
        }
        return $result;
    }

    private function assertExperimentAccess(int $experimentId, AccessType $access): void
    {
        if ($experimentId < 1) {
            throw new ImproperActionException('Invalid eLabFTW experiment identifier.');
        }
        $Experiment = new Experiments($this->requester, $experimentId);
        $Experiment->readOne();
        $Experiment->canOrExplode($access);
    }

    private function validateEntityType(string $entityType): string
    {
        $entityType = trim($entityType);
        if (!in_array($entityType, array('animal', 'cage'), true)) {
            throw new ImproperActionException('PyRAT entity type must be animal or cage.');
        }
        return $entityType;
    }
}
