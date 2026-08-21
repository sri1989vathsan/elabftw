<?php

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\BodyContentType;
use Elabftw\Enums\EntityType;
use PDO;

/** Maintain the fork-owned, date-indexed representation of entity headings. */
final class CalendarActivityIndexer
{
    private Db $Db;

    public function __construct(private CalendarActivityHeadingExtractor $Extractor = new CalendarActivityHeadingExtractor())
    {
        $this->Db = Db::getConnection();
    }

    /** Index new or modified entities in a team. Existing installations are backfilled on first calendar use. */
    public function synchronizeTeam(EntityType $type, int $teamId): void
    {
        $sql = sprintf(
            'SELECT entity.id, entity.team, entity.userid, entity.date, entity.body, entity.content_type, entity.modified_at
             FROM %s AS entity
             LEFT JOIN custom_calendar_activity_index_state AS state
               ON state.entity_type = :entity_type AND state.entity_id = entity.id
             WHERE entity.team = :team
               AND (state.entity_id IS NULL OR state.source_modified_at <> entity.modified_at)',
            $type->value,
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':entity_type', $type->value);
        $req->bindValue(':team', $teamId, PDO::PARAM_INT);
        $this->Db->execute($req);
        foreach ($req->fetchAll() as $entity) {
            $this->replace($type, $entity);
        }
    }

    private function replace(EntityType $type, array $entity): void
    {
        $this->Db->beginTransaction();
        try {
            $delete = $this->Db->prepare(
                'DELETE FROM custom_calendar_activity_entries WHERE entity_type = :entity_type AND entity_id = :entity_id',
            );
            $delete->bindValue(':entity_type', $type->value);
            $delete->bindValue(':entity_id', $entity['id'], PDO::PARAM_INT);
            $this->Db->execute($delete);

            $headings = $this->Extractor->extract(
                (string) ($entity['body'] ?? ''),
                BodyContentType::from((int) $entity['content_type']),
                (string) $entity['date'],
            );
            $insert = $this->Db->prepare(
                'INSERT INTO custom_calendar_activity_entries
                    (entity_type, entity_id, heading_index, entry_date, heading_level, heading_text, parent_index, anchor, team_id, owner_id)
                 VALUES
                    (:entity_type, :entity_id, :heading_index, :entry_date, :heading_level, :heading_text, :parent_index, :anchor, :team_id, :owner_id)',
            );
            foreach ($headings as $heading) {
                $insert->bindValue(':entity_type', $type->value);
                $insert->bindValue(':entity_id', $entity['id'], PDO::PARAM_INT);
                $insert->bindValue(':heading_index', $heading['index'], PDO::PARAM_INT);
                $insert->bindValue(':entry_date', $heading['date']);
                $insert->bindValue(':heading_level', $heading['level'], PDO::PARAM_INT);
                $insert->bindValue(':heading_text', $heading['text']);
                $insert->bindValue(':parent_index', $heading['parent_index'], $heading['parent_index'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
                $insert->bindValue(':anchor', $heading['anchor']);
                $insert->bindValue(':team_id', $entity['team'], PDO::PARAM_INT);
                $insert->bindValue(':owner_id', $entity['userid'], PDO::PARAM_INT);
                $this->Db->execute($insert);
            }

            $state = $this->Db->prepare(
                'INSERT INTO custom_calendar_activity_index_state (entity_type, entity_id, source_modified_at)
                 VALUES (:entity_type, :entity_id, :modified_at)
                 ON DUPLICATE KEY UPDATE source_modified_at = VALUES(source_modified_at), indexed_at = CURRENT_TIMESTAMP',
            );
            $state->bindValue(':entity_type', $type->value);
            $state->bindValue(':entity_id', $entity['id'], PDO::PARAM_INT);
            $state->bindValue(':modified_at', $entity['modified_at']);
            $this->Db->execute($state);
            $this->Db->commit();
        } catch (\Throwable $error) {
            $this->Db->rollBack();
            throw $error;
        }
    }
}
