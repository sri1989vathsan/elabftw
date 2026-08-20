<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Exceptions\ImproperActionException;
use PDO;

use function array_fill;
use function array_map;
use function array_values;
use function count;
use function implode;
use function in_array;
use function mb_strlen;
use function sprintf;
use function trim;

/**
 * Store fork-owned descriptions without altering upstream domain tables.
 */
final class CustomUiDescriptions
{
    public const string EXPERIMENT_GOAL = 'experiment_goal';

    public const string EXPERIMENT_CONCLUSION = 'experiment_conclusion';

    public const string EXPERIMENT_FOLDER = 'experiment_folder';

    public const string EXPERIMENT_CATEGORY = 'experiment_category';

    public const string RESOURCE_CATEGORY = 'resource_category';

    public const int MAX_LENGTH = 500;

    public const int MAX_SUMMARY_LENGTH = 1000;

    private Db $Db;

    public function __construct()
    {
        $this->Db = Db::getConnection();
    }

    public function read(string $scope, int $entityId): string
    {
        $this->validateScope($scope);
        $req = $this->Db->prepare(
            'SELECT description FROM custom_ui_descriptions WHERE scope = :scope AND entity_id = :entity_id',
        );
        $req->bindValue(':scope', $scope);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $this->Db->execute($req);
        $description = $req->fetchColumn();
        return $description === false ? '' : (string) $description;
    }

    /**
     * Add a metadata value to every API row without introducing N+1 queries.
     *
     * @param array<array-key, array<string, mixed>> $rows
     * @return array<array-key, array<string, mixed>>
     */
    public function enrichRows(string $scope, array $rows, string $outputKey = 'description'): array
    {
        $this->validateScope($scope);
        if ($rows === array()) {
            return $rows;
        }

        $ids = array_values(array_map(static fn(array $row): int => (int) $row['id'], $rows));
        $placeholders = implode(', ', array_fill(0, count($ids), '?'));
        $req = $this->Db->prepare(sprintf(
            'SELECT entity_id, description FROM custom_ui_descriptions WHERE scope = ? AND entity_id IN (%s)',
            $placeholders,
        ));
        $req->bindValue(1, $scope);
        foreach ($ids as $index => $id) {
            $req->bindValue($index + 2, $id, PDO::PARAM_INT);
        }
        $this->Db->execute($req);

        $descriptions = array();
        while ($row = $req->fetch(PDO::FETCH_ASSOC)) {
            $descriptions[(int) $row['entity_id']] = (string) $row['description'];
        }
        foreach ($rows as &$row) {
            $row[$outputKey] = $descriptions[(int) $row['id']] ?? '';
        }
        unset($row);
        return $rows;
    }

    public function write(string $scope, int $entityId, string $description): void
    {
        $this->validateScope($scope);
        $description = trim($description);
        if ($this->isExperimentSummary($scope)) {
            if (mb_strlen($description) > self::MAX_SUMMARY_LENGTH) {
                throw new ImproperActionException('Experiment summaries must be 1000 characters or fewer.');
            }
        } elseif (mb_strlen($description) > self::MAX_LENGTH) {
            throw new ImproperActionException('Description must be 500 characters or fewer.');
        }
        if ($description === '') {
            $this->delete($scope, $entityId);
            return;
        }

        $req = $this->Db->prepare(
            'INSERT INTO custom_ui_descriptions (scope, entity_id, description)
                VALUES (:scope, :entity_id, :description)
                ON DUPLICATE KEY UPDATE description = VALUES(description)',
        );
        $req->bindValue(':scope', $scope);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $req->bindValue(':description', $description);
        $this->Db->execute($req);
    }

    public function delete(string $scope, int $entityId): void
    {
        $this->validateScope($scope);
        $req = $this->Db->prepare(
            'DELETE FROM custom_ui_descriptions WHERE scope = :scope AND entity_id = :entity_id',
        );
        $req->bindValue(':scope', $scope);
        $req->bindValue(':entity_id', $entityId, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function validateScope(string $scope): void
    {
        if (!in_array($scope, array(
            self::EXPERIMENT_GOAL,
            self::EXPERIMENT_CONCLUSION,
            self::EXPERIMENT_FOLDER,
            self::EXPERIMENT_CATEGORY,
            self::RESOURCE_CATEGORY,
        ), true)) {
            throw new ImproperActionException('Invalid UI description scope.');
        }
    }

    private function isExperimentSummary(string $scope): bool
    {
        return in_array($scope, array(self::EXPERIMENT_GOAL, self::EXPERIMENT_CONCLUSION), true);
    }
}
