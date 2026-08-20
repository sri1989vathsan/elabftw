<?php

/**
 * @author Andreas Moor
 * @copyright 2026 Andreas Moor
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Params\CommentParam;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_key_exists;

/**
 * Shared hierarchical folders for experiments and resources.
 */
final class ExperimentsFolders extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $requester, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/experiments_folders/';
    }

    /**
     * Read one folder with its full path
     */
    #[Override]
    public function readOne(): array
    {
        $sql = "
            WITH RECURSIVE folder_hierarchy AS (
                SELECT
                    id,
                    id AS original_id,
                    name,
                    parent_id,
                    parent_id AS original_parent_id,
                    CAST(name AS CHAR(1000)) AS full_path,
                    0 AS level_depth
                FROM
                    experiments_folders
                WHERE
                    id = :id

                UNION

                SELECT
                    parent.id,
                    child.original_id,
                    child.name,
                    parent.parent_id,
                    child.original_parent_id,
                    CAST(CONCAT(parent.name, ' > ', child.full_path) AS CHAR(1000)) AS full_path,
                    child.level_depth + 1
                FROM
                    experiments_folders AS parent
                INNER JOIN
                    folder_hierarchy AS child ON parent.id = child.parent_id
            )

            SELECT
                original_id AS id,
                name,
                full_path,
                original_parent_id AS parent_id,
                level_depth
            FROM
                folder_hierarchy
            ORDER BY
                level_depth DESC LIMIT 1;
        ";

        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return (new CustomUiDescriptions())->enrichRows(
            CustomUiDescriptions::EXPERIMENT_FOLDER,
            array($this->Db->fetch($req)),
        )[0];
    }

    /**
     * Read all folders as a flat list or as a hierarchy
     */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        if ($queryParams->getQuery()->getBoolean('hierarchy')) {
            return $this->readHierarchyRows();
        }
        return $this->readHierarchyRows();
    }

    /**
     * Read all folders grouped by parent_id for building a tree
     */
    public function readAllRecursive(): array
    {
        $all = $this->readHierarchyRows();
        $groupedItems = array();
        foreach ($all as $item) {
            $groupedItems[$item['parent_id']][] = $item;
        }
        return $groupedItems;
    }

    /**
     * Read experiments inside a specific folder
     */
    public function readExperimentsInFolder(?int $folderId = null): array
    {
        if ($folderId === null) {
            // Read experiments with no folder (root level)
            $sql = 'SELECT id, title, date, created_at, modified_at
                FROM experiments
                WHERE folder_id IS NULL
                AND team = :team
                AND state = 1
                ORDER BY modified_at DESC';
            $req = $this->Db->prepare($sql);
        } else {
            $sql = 'SELECT id, title, date, created_at, modified_at
                FROM experiments
                WHERE folder_id = :folder_id
                AND team = :team
                AND state = 1
                ORDER BY modified_at DESC';
            $req = $this->Db->prepare($sql);
            $req->bindParam(':folder_id', $folderId, PDO::PARAM_INT);
        }
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        // Handle toggling favorite (no folder id needed in URL — uses current user)
        if (isset($params['action']) && $params['action'] === 'toggle_favorite') {
            $folderId = Filter::intOrNull($params['folder_id'] ?? null);
            $this->toggleFavorite($folderId);
            return array('favorite_experiment_folder' => $this->getFavoriteFolder());
        }

        $this->canWriteOrExplode();

        // Handle moving to a different parent
        if (isset($params['parent_id'])) {
            $this->moveToParent(Filter::intOrNull($params['parent_id']));
        }

        // Handle renaming
        if (!empty($params['name'])) {
            $this->update(new CommentParam($params['name']));
        }

        if (array_key_exists('description', $params)) {
            (new CustomUiDescriptions())->write(
                CustomUiDescriptions::EXPERIMENT_FOLDER,
                (int) $this->id,
                (string) $params['description'],
            );
        }

        return $this->readOne();
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->canWriteOrExplode();
        $id = $this->create(
            $reqBody['name'] ?? throw new ImproperActionException('Missing value for "name"'),
            Filter::intOrNull($reqBody['parent_id'] ?? 0),
        );
        if (array_key_exists('description', $reqBody)) {
            (new CustomUiDescriptions())->write(
                CustomUiDescriptions::EXPERIMENT_FOLDER,
                $id,
                (string) $reqBody['description'],
            );
        }
        return $id;
    }

    public function create(string $folderName, ?int $parentId = null): int
    {
        $sql = 'INSERT INTO experiments_folders(team, name, parent_id, userid)
            VALUES(:team, :name, :parent_id, :userid)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindParam(':name', $folderName);
        $req->bindParam(':parent_id', $parentId);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    public function update(CommentParam $params): bool
    {
        $sql = 'UPDATE experiments_folders SET
            name = :name
            WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':name', $params->getContent());
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    #[Override]
    public function destroy(): bool
    {
        $this->canWriteOrExplode();
        if ($this->hasChildren()) {
            throw new ImproperActionException(_('Cannot delete a folder with subfolders! Delete the subfolders first.'));
        }
        // Move any entities in this folder back to root (no folder).
        $this->unassignEntities();

        $sql = 'DELETE FROM experiments_folders WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);

        $deleted = $this->Db->execute($req);
        if ($deleted) {
            (new CustomUiDescriptions())->delete(CustomUiDescriptions::EXPERIMENT_FOLDER, (int) $this->id);
        }
        return $deleted;
    }

    /**
     * Assign an experiment to a folder
     */
    public function assignExperiment(int $experimentId, ?int $folderId): bool
    {
        $sql = 'UPDATE experiments SET folder_id = :folder_id WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':folder_id', $folderId);
        $req->bindParam(':id', $experimentId, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Assign a resource to a folder.
     */
    public function assignResource(int $resourceId, ?int $folderId): bool
    {
        $sql = 'UPDATE items SET folder_id = :folder_id WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':folder_id', $folderId);
        $req->bindParam(':id', $resourceId, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Get the full hierarchy as a flat list with depth info
     */
    public function readHierarchyRows(): array
    {
        $sql = "WITH RECURSIVE folder_hierarchy AS (
            SELECT
                id,
                name,
                parent_id,
                userid,
                id AS root_id,
                name AS full_path,
                0 AS level_depth,
                (SELECT COUNT(*) FROM experiments_folders AS ef WHERE ef.parent_id = experiments_folders.id) AS children_count,
                (SELECT COUNT(*) FROM experiments AS e WHERE e.folder_id = experiments_folders.id AND e.state = 1) AS experiments_count,
                (SELECT COUNT(*) FROM items AS i WHERE i.folder_id = experiments_folders.id AND i.state = 1) AS resources_count
            FROM
                experiments_folders
            WHERE
                parent_id IS NULL
                AND team = :team

            UNION

            SELECT
                child.id,
                child.name,
                child.parent_id,
                child.userid,
                parent.root_id,
                CONCAT(parent.full_path, ' > ', child.name) AS full_path,
                parent.level_depth + 1,
                (SELECT COUNT(*) FROM experiments_folders AS ef WHERE ef.parent_id = child.id) AS children_count,
                (SELECT COUNT(*) FROM experiments AS e WHERE e.folder_id = child.id AND e.state = 1) AS experiments_count,
                (SELECT COUNT(*) FROM items AS i WHERE i.folder_id = child.id AND i.state = 1) AS resources_count
            FROM
                experiments_folders AS child
            INNER JOIN
                folder_hierarchy AS parent
            ON
                child.parent_id = parent.id
        )

        SELECT
            id,
            name,
            full_path,
            parent_id,
            userid,
            root_id,
            level_depth,
            children_count,
            experiments_count,
            resources_count
        FROM
            folder_hierarchy
        ORDER BY
            name, parent_id";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return (new CustomUiDescriptions())->enrichRows(
            CustomUiDescriptions::EXPERIMENT_FOLDER,
            $req->fetchAll(),
        );
    }

    /**
     * Get the current user's favorite experiment folder id (or null)
     */
    public function getFavoriteFolder(): ?int
    {
        $sql = 'SELECT favorite_experiment_folder FROM users WHERE userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
        $result = $req->fetchColumn();
        return $result !== false && $result !== null ? (int) $result : null;
    }

    /**
     * Resolve a folder to the root branch that contains it.
     */
    public function getRootFolderId(?int $folderId): ?int
    {
        if ($folderId === null) {
            return null;
        }
        $sql = 'WITH RECURSIVE folder_ancestors AS (
            SELECT id, parent_id, team
            FROM experiments_folders
            WHERE id = :folder_id AND team = :root_team

            UNION ALL

            SELECT parent.id, parent.parent_id, parent.team
            FROM experiments_folders AS parent
            INNER JOIN folder_ancestors AS child ON child.parent_id = parent.id
            WHERE parent.team = :ancestor_team
        )
        SELECT id FROM folder_ancestors WHERE parent_id IS NULL LIMIT 1';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $req->bindValue(':root_team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':ancestor_team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        $result = $req->fetchColumn();
        return $result === false ? null : (int) $result;
    }

    /**
     * Toggle the favorite folder for the current user.
     * If the folder is already the favorite, unset it; otherwise set it.
     */
    private function toggleFavorite(?int $folderId): void
    {
        $current = $this->getFavoriteFolder();
        $newValue = ($current === $folderId) ? null : $folderId;

        $sql = 'UPDATE users SET favorite_experiment_folder = :fav WHERE userid = :userid';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':fav', $newValue, $newValue === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function moveToParent(?int $parentId): bool
    {
        // Prevent moving a folder into itself or its own children
        if ($parentId !== null && $parentId === $this->id) {
            throw new ImproperActionException(_('Cannot move a folder into itself!'));
        }
        $sql = 'UPDATE experiments_folders SET parent_id = :parent_id WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':parent_id', $parentId);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function hasChildren(): bool
    {
        $sql = 'SELECT id FROM experiments_folders WHERE parent_id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (bool) $req->fetchColumn();
    }

    /**
     * Move all experiments and resources from this folder to root (no folder).
     */
    private function unassignEntities(): void
    {
        $sql = 'UPDATE experiments SET folder_id = NULL WHERE folder_id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        $sql = 'UPDATE items SET folder_id = NULL WHERE folder_id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function canWrite(): bool
    {
        // Any user who can create experiments can manage folders
        return true;
    }

    private function canWriteOrExplode(): void
    {
        if (!$this->canWrite()) {
            throw new IllegalActionException();
        }
    }
}
