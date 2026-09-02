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

use Elabftw\Elabftw\CanSqlBuilder;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\Action;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Params\CommentParam;
use Elabftw\Services\Filter;
use Elabftw\Services\SlowOperationTimer;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_key_exists;
use function count;
use function in_array;
use function _;

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
                    AND team = :team

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
                hierarchy.original_id AS id,
                hierarchy.name,
                hierarchy.full_path,
                hierarchy.original_parent_id AS parent_id,
                hierarchy.level_depth,
                folders.userid,
                COALESCE(readmes.body, '') AS readme_body,
                COALESCE(readmes.content_type, 1) AS readme_content_type,
                readmes.updated_at AS readme_updated_at
            FROM
                folder_hierarchy AS hierarchy
            INNER JOIN experiments_folders AS folders ON folders.id = hierarchy.original_id
            LEFT JOIN custom_experiment_folder_readmes AS readmes ON readmes.folder_id = hierarchy.original_id
            ORDER BY
                hierarchy.level_depth DESC LIMIT 1;
        ";

        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        $folder = $this->Db->fetch($req);
        if ($folder === false) {
            throw new ResourceNotFoundException('Folder not found in the current team.');
        }
        $folder['has_readme'] = $folder['readme_body'] !== '';
        $folder['can_edit_readme'] = $this->canEditReadme((int) $folder['userid']);
        return (new CustomUiDescriptions())->enrichRows(
            CustomUiDescriptions::EXPERIMENT_FOLDER,
            array($folder),
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
        $canRead = (new CanSqlBuilder($this->requester, AccessType::Read))->getCanFilter();
        if ($folderId === null) {
            // Read experiments with no folder (root level)
            $sql = 'SELECT entity.id, entity.title, entity.date, entity.created_at, entity.modified_at
                FROM experiments AS entity
                WHERE entity.folder_id IS NULL
                AND entity.team = :team
                AND entity.state = 1' . $canRead . '
                ORDER BY entity.modified_at DESC';
            $req = $this->Db->prepare($sql);
        } else {
            $sql = 'SELECT entity.id, entity.title, entity.date, entity.created_at, entity.modified_at
                FROM experiments AS entity
                WHERE entity.folder_id = :folder_id
                AND entity.team = :team
                AND entity.state = 1' . $canRead . '
                ORDER BY entity.modified_at DESC';
            $req = $this->Db->prepare($sql);
            $req->bindParam(':folder_id', $folderId, PDO::PARAM_INT);
        }
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':userid', $this->requester->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        // Handle toggling favorite (no folder id needed in URL — uses current user)
        if (isset($params['action']) && $params['action'] === 'toggle_favorite') {
            $folderId = Filter::intOrNull($params['folder_id'] ?? null);
            if ($folderId === null) {
                throw new ImproperActionException('A folder id is required to toggle a bookmark.');
            }
            $this->toggleFavorite($folderId);
            return array('favorite_experiment_folders' => $this->getFavoriteFolders());
        }

        if (array_key_exists('readme_body', $params)) {
            $folder = $this->readOne();
            if (!$folder['can_edit_readme']) {
                throw new IllegalActionException();
            }
            $contentType = (int) ($params['readme_content_type'] ?? $folder['readme_content_type']);
            if (!in_array($contentType, array(1, 2), true)) {
                throw new ImproperActionException('Invalid folder README content type.');
            }
            $this->writeReadme((string) $params['readme_body'], $contentType);
            return $this->readOne();
        }

        $this->canWriteOrExplode();

        // Handle moving to a different parent
        if (array_key_exists('parent_id', $params)) {
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
        $Timer = SlowOperationTimer::start('folder_hierarchy', array(
            'team_id' => (int) $this->requester->userData['team'],
        ));
        $sql = "WITH RECURSIVE folder_hierarchy AS (
            SELECT
                id,
                name,
                parent_id,
                userid,
                id AS root_id,
                name AS full_path,
                0 AS level_depth
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
                parent.level_depth + 1
            FROM
                experiments_folders AS child
            INNER JOIN
                folder_hierarchy AS parent
            ON
                child.parent_id = parent.id
        )

        SELECT
            folder_hierarchy.id,
            folder_hierarchy.name,
            folder_hierarchy.full_path,
            folder_hierarchy.parent_id,
            folder_hierarchy.userid,
            folder_hierarchy.root_id,
            folder_hierarchy.level_depth,
            COALESCE(child_counts.children_count, 0) AS children_count,
            COALESCE(experiment_counts.experiments_count, 0) AS experiments_count,
            COALESCE(resource_counts.resources_count, 0) AS resources_count,
            (readmes.folder_id IS NOT NULL) AS has_readme
        FROM
            folder_hierarchy
        LEFT JOIN (
            SELECT parent_id, COUNT(*) AS children_count
            FROM experiments_folders
            WHERE parent_id IS NOT NULL
            GROUP BY parent_id
        ) AS child_counts ON child_counts.parent_id = folder_hierarchy.id
        LEFT JOIN (
            SELECT folder_id, COUNT(*) AS experiments_count
            FROM experiments
            WHERE state = 1 AND folder_id IS NOT NULL
            GROUP BY folder_id
        ) AS experiment_counts ON experiment_counts.folder_id = folder_hierarchy.id
        LEFT JOIN (
            SELECT folder_id, COUNT(*) AS resources_count
            FROM items
            WHERE state = 1 AND folder_id IS NOT NULL
            GROUP BY folder_id
        ) AS resource_counts ON resource_counts.folder_id = folder_hierarchy.id
        LEFT JOIN custom_experiment_folder_readmes AS readmes
            ON readmes.folder_id = folder_hierarchy.id AND readmes.body <> ''
        ORDER BY
            folder_hierarchy.name, folder_hierarchy.parent_id";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        $rows = (new CustomUiDescriptions())->enrichRows(
            CustomUiDescriptions::EXPERIMENT_FOLDER,
            $req->fetchAll(),
        );
        $Timer->finish(count($rows));
        return $rows;
    }

    /** @return list<int> Current user's bookmarked folder ids. */
    public function getFavoriteFolders(): array
    {
        $sql = 'SELECT bookmarks.folder_id
            FROM custom_favorite_experiment_folders AS bookmarks
            INNER JOIN experiments_folders AS folders ON folders.id = bookmarks.folder_id
            WHERE bookmarks.users_id = :userid
                AND folders.team = :team
            ORDER BY bookmarks.created_at, bookmarks.folder_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);

        $folderIds = array();
        foreach ($req->fetchAll(PDO::FETCH_COLUMN) as $folderId) {
            $folderIds[] = (int) $folderId;
        }
        return $folderIds;
    }

    /** @return list<int> Unique root branches containing the current user's bookmarks. */
    public function getFavoriteRootFolderIds(): array
    {
        $sql = 'WITH RECURSIVE folder_ancestors AS (
            SELECT folders.id, folders.parent_id
            FROM experiments_folders AS folders
            INNER JOIN custom_favorite_experiment_folders AS bookmarks ON bookmarks.folder_id = folders.id
            WHERE bookmarks.users_id = :userid
                AND folders.team = :root_team

            UNION ALL

            SELECT parent.id, parent.parent_id
            FROM experiments_folders AS parent
            INNER JOIN folder_ancestors AS child ON child.parent_id = parent.id
            WHERE parent.team = :ancestor_team
        )
        SELECT DISTINCT id
        FROM folder_ancestors
        WHERE parent_id IS NULL
        ORDER BY id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':root_team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':ancestor_team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);

        $rootIds = array();
        foreach ($req->fetchAll(PDO::FETCH_COLUMN) as $rootId) {
            $rootIds[] = (int) $rootId;
        }
        return $rootIds;
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

    /** Toggle one folder in the current user's bookmark set. */
    private function toggleFavorite(int $folderId): void
    {
        if ($this->getRootFolderId($folderId) === null) {
            throw new ResourceNotFoundException('Folder not found in the current team.');
        }

        $sql = 'DELETE FROM custom_favorite_experiment_folders
            WHERE users_id = :userid AND folder_id = :folder_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $this->Db->execute($req);
        if ($req->rowCount() > 0) {
            return;
        }

        $sql = 'INSERT IGNORE INTO custom_favorite_experiment_folders (users_id, folder_id)
            VALUES (:userid, :folder_id)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function moveToParent(?int $parentId): bool
    {
        if ($parentId !== null) {
            // Resolve every descendant of this folder. Selecting any of them as
            // the new parent would create a cycle and break recursive folder reads.
            $sql = 'WITH RECURSIVE descendants AS (
                SELECT id
                FROM experiments_folders
                WHERE id = :folder_id AND team = :folder_team

                UNION ALL

                SELECT child.id
                FROM experiments_folders AS child
                INNER JOIN descendants AS parent ON child.parent_id = parent.id
                WHERE child.team = :child_team
            )
            SELECT EXISTS(SELECT 1 FROM descendants WHERE id = :parent_id)';
            $req = $this->Db->prepare($sql);
            $req->bindParam(':folder_id', $this->id, PDO::PARAM_INT);
            $req->bindValue(':folder_team', $this->requester->userData['team'], PDO::PARAM_INT);
            $req->bindValue(':child_team', $this->requester->userData['team'], PDO::PARAM_INT);
            $req->bindValue(':parent_id', $parentId, PDO::PARAM_INT);
            $this->Db->execute($req);
            if ((bool) $req->fetchColumn()) {
                throw new ImproperActionException(_('Cannot move a folder inside itself or one of its subfolders!'));
            }

            // A parent id from another team (or a deleted/non-existent folder)
            // must never be accepted even if foreign-key constraints are absent.
            $sql = 'SELECT EXISTS(
                SELECT 1 FROM experiments_folders WHERE id = :parent_id AND team = :team
            )';
            $req = $this->Db->prepare($sql);
            $req->bindValue(':parent_id', $parentId, PDO::PARAM_INT);
            $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
            $this->Db->execute($req);
            if (!(bool) $req->fetchColumn()) {
                throw new ImproperActionException(_('The selected parent folder does not exist in the current team.'));
            }
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

    private function canEditReadme(int $ownerId): bool
    {
        return $ownerId === (int) $this->requester->userData['userid']
            || $this->requester->isAdmin()
            || $this->requester->isSysadmin();
    }

    private function writeReadme(string $body, int $contentType): void
    {
        $sql = 'INSERT INTO custom_experiment_folder_readmes (folder_id, body, content_type, updated_by)
            VALUES (:folder_id, :body, :content_type, :updated_by)
            ON DUPLICATE KEY UPDATE body = VALUES(body), content_type = VALUES(content_type),
                updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':folder_id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':body', Filter::body($body));
        $req->bindValue(':content_type', $contentType, PDO::PARAM_INT);
        $req->bindValue(':updated_by', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
    }
}
