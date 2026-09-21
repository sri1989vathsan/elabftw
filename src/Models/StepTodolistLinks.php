<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use PDO;

/**
 * Tiny lookup table linking one experiment/resource step to the to-do task
 * that reflects its deadline (see Steps::syncLinkedTodo()). Not a REST
 * resource of its own -- just plain static helpers, used from both Steps
 * (to create/update/remove the reflection) and Todolist (to sync a step's
 * "finished" state back when its linked task is completed/reopened).
 */
final class StepTodolistLinks
{
    public static function findTodolistId(string $entityType, int $stepId): ?int
    {
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'SELECT todolist_id FROM custom_step_todolist_links WHERE entity_type = :entity_type AND step_id = :step_id',
        );
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $Db->execute($req);
        $todolistId = $req->fetchColumn();
        return $todolistId !== false ? (int) $todolistId : null;
    }

    /** @return array{entity_type: string, step_id: int}|null */
    public static function findStepForTodolist(int $todolistId): ?array
    {
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'SELECT entity_type, step_id FROM custom_step_todolist_links WHERE todolist_id = :todolist_id',
        );
        $req->bindValue(':todolist_id', $todolistId, PDO::PARAM_INT);
        $Db->execute($req);
        $row = $req->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }
        return array('entity_type' => (string) $row['entity_type'], 'step_id' => (int) $row['step_id']);
    }

    public static function link(string $entityType, int $stepId, int $todolistId): void
    {
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'INSERT INTO custom_step_todolist_links (entity_type, step_id, todolist_id)
                VALUES (:entity_type, :step_id, :todolist_id)
                ON DUPLICATE KEY UPDATE todolist_id = VALUES(todolist_id)',
        );
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $req->bindValue(':todolist_id', $todolistId, PDO::PARAM_INT);
        $Db->execute($req);
    }

    /** Removes the link and returns the to-do id it pointed to, if any. */
    public static function unlink(string $entityType, int $stepId): ?int
    {
        $todolistId = self::findTodolistId($entityType, $stepId);
        if ($todolistId === null) {
            return null;
        }
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'DELETE FROM custom_step_todolist_links WHERE entity_type = :entity_type AND step_id = :step_id',
        );
        $req->bindValue(':entity_type', $entityType);
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $Db->execute($req);
        return $todolistId;
    }
}
