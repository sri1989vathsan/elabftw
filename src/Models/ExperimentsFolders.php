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
use Elabftw\Elabftw\TwigFunctions;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\Action;
use Elabftw\Enums\BasePermissions;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Exceptions\UnprocessableContentException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Params\CommentParam;
use Elabftw\Services\Check;
use Elabftw\Services\Filter;
use Elabftw\Services\SlowOperationTimer;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_column;
use function array_map;
use function array_unique;
use function array_values;
use function implode;
use function json_decode;
use function json_encode;
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
        $folder['can_manage_permissions'] = $this->canManagePermissions((int) $folder['userid']);
        $folder['permissions'] = $this->readPermissions((int) $folder['id']);
        if ($folder['permissions'] !== null) {
            // names of the individually selected users, so the permissions dialog can show them
            foreach (array('canread', 'canwrite') as $key) {
                $folder['permissions'][$key . '_users'] = TwigFunctions::canToHuman((string) json_encode($folder['permissions'][$key]))['users'] ?? array();
            }
        }
        $folder['permission_item_count'] = $this->countItemsInTree((int) $folder['id']);
        // What a folder with nothing remembered yet starts from: the requester's own default permissions
        // for new experiments and resources (Settings > Experiments).
        $userData = $this->requester->userData;
        $defaultRead = (string) ($userData['default_read'] ?? '{"teams":[],"teamgroups":[],"users":[]}');
        $defaultWrite = (string) ($userData['default_write'] ?? '{"teams":[],"teamgroups":[],"users":[]}');
        $folder['default_permissions'] = array(
            'canread_base' => (int) ($userData['default_read_base'] ?? BasePermissions::Team->value),
            'canwrite_base' => (int) ($userData['default_write_base'] ?? BasePermissions::User->value),
            'canread' => json_decode($defaultRead, true) ?? array('teams' => array(), 'teamgroups' => array(), 'users' => array()),
            'canwrite' => json_decode($defaultWrite, true) ?? array('teams' => array(), 'teamgroups' => array(), 'users' => array()),
            'canread_users' => TwigFunctions::canToHuman($defaultRead)['users'] ?? array(),
            'canwrite_users' => TwigFunctions::canToHuman($defaultWrite)['users'] ?? array(),
        );
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

    /**
     * Get the ids of all experiments inside a folder and its subfolders, for export
     *
     * @return array<int>
     */
    public function getIdFromFolder(int $folderId): array
    {
        $canRead = (new CanSqlBuilder($this->requester, AccessType::Read))->getCanFilter();
        $sql = 'WITH RECURSIVE folder_tree AS (
                SELECT id FROM experiments_folders WHERE id = :folder_id AND team = :team

                UNION ALL

                SELECT child.id FROM experiments_folders AS child
                INNER JOIN folder_tree ON child.parent_id = folder_tree.id
            )
            SELECT entity.id
            FROM experiments AS entity
            INNER JOIN folder_tree ON folder_tree.id = entity.folder_id
            WHERE entity.team = :team
            AND entity.state = 1' . $canRead . '
            ORDER BY entity.modified_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':folder_id', $folderId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':userid', $this->requester->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_column($req->fetchAll(), 'id');
    }

    /**
     * Same as getIdFromFolder() but for resources (items), for export
     *
     * @return array<int>
     */
    public function getIdFromFolderForItems(int $folderId): array
    {
        $canRead = (new CanSqlBuilder($this->requester, AccessType::Read))->getCanFilter();
        $sql = 'WITH RECURSIVE folder_tree AS (
                SELECT id FROM experiments_folders WHERE id = :folder_id AND team = :team

                UNION ALL

                SELECT child.id FROM experiments_folders AS child
                INNER JOIN folder_tree ON child.parent_id = folder_tree.id
            )
            SELECT entity.id
            FROM items AS entity
            INNER JOIN folder_tree ON folder_tree.id = entity.folder_id
            WHERE entity.team = :team
            AND entity.state = 1' . $canRead . '
            ORDER BY entity.modified_at DESC';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':folder_id', $folderId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':userid', $this->requester->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_column($req->fetchAll(), 'id');
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

        if (isset($params['action']) && $params['action'] === 'set_folder_permissions') {
            return $this->setFolderPermissions($params);
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

    /**
     * Find or create a folder path such as "Parent > Child" (the same
     * separator used in full_path), creating any missing segment along the
     * way. Used when importing a .eln so an entity can be refiled into the
     * same folder it was exported from.
     */
    public function getIdFromPath(string $path): int
    {
        $parentId = null;
        foreach (array_filter(array_map('trim', explode(' > ', $path)), fn(string $s): bool => $s !== '') as $segment) {
            $parentId = $this->getIdempotentIdFromNameAndParent($segment, $parentId);
        }
        return $parentId ?? throw new ImproperActionException('Cannot resolve an empty folder path.');
    }

    private function getIdempotentIdFromNameAndParent(string $name, ?int $parentId): int
    {
        $sql = 'SELECT id FROM experiments_folders WHERE team = :team AND name = :name AND parent_id <=> :parent_id LIMIT 1';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':name', $name);
        // bindValue, not bindParam -- bindParam binds by reference, and
        // PDO's own implicit type coercion for an untyped bind can mutate
        // the referenced variable to a string once execute() runs. $parentId
        // going from int|null to a string right here broke the create()
        // call receiving it as a fallthrough two lines below (a real
        // ?int parameter), throwing a TypeError instead of creating the
        // folder -- only ever surfaced once the ResourceNotFoundException
        // bug above this was fixed and execution could actually reach it.
        $req->bindValue(':parent_id', $parentId);
        $this->Db->execute($req);
        // Not $this->Db->fetch($req) -- that throws ResourceNotFoundException
        // on an empty result, but finding no existing folder by this name/
        // parent here is the normal, expected case (it's what falls through
        // to create() below), not an error. Using it made that fallthrough
        // dead code and made this idempotent lookup throw "Nothing to show
        // with this id" instead of creating the folder -- reported via
        // .eln import (getIdFromPath()'s own caller) failing outright
        // whenever a folder in the exported path didn't already exist on
        // the importing instance.
        $res = $req->fetch();
        if ($res !== false) {
            return (int) $res['id'];
        }
        return $this->create($name, $parentId);
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
        $newId = $this->Db->lastInsertId();
        // A subfolder starts with the permissions its parent folder remembers, so items filed in it
        // get the same access without the permissions having to be set again.
        if ($parentId !== null) {
            $this->copyStoredPermissions((int) $parentId, $newId);
        }
        return $newId;
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
        $result = $this->Db->execute($req);
        if ($folderId !== null) {
            $this->applyFolderPermissionsToEntity(Experiments::class, $experimentId, (int) $folderId);
        }
        return $result;
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
        $result = $this->Db->execute($req);
        if ($folderId !== null) {
            $this->applyFolderPermissionsToEntity(Items::class, $resourceId, (int) $folderId);
        }
        return $result;
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

    /**
     * Who may set the permissions remembered by a folder: its owner and (sys)admins.
     */
    private function canManagePermissions(int $ownerId): bool
    {
        return $ownerId === (int) $this->requester->userData['userid']
            || $this->requester->isAdmin()
            || $this->requester->isSysadmin();
    }

    /**
     * The permissions a folder remembers, or null if none were set.
     *
     * @return array{canread_base: int, canwrite_base: int, canread: array, canwrite: array}|null
     */
    public function readPermissions(?int $folderId = null): ?array
    {
        $folderId ??= (int) $this->id;
        $req = $this->Db->prepare(
            'SELECT canread_base, canwrite_base, canread, canwrite FROM custom_experiment_folder_permissions WHERE folder_id = :folder_id',
        );
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $req->fetch();
        if ($row === false) {
            return null;
        }
        return array(
            'canread_base' => (int) $row['canread_base'],
            'canwrite_base' => (int) $row['canwrite_base'],
            'canread' => json_decode((string) $row['canread'], true) ?? array('teams' => array(), 'teamgroups' => array(), 'users' => array()),
            'canwrite' => json_decode((string) $row['canwrite'], true) ?? array('teams' => array(), 'teamgroups' => array(), 'users' => array()),
        );
    }

    /**
     * Ids of a folder and all folders below it (same team).
     *
     * @return array<int>
     */
    private function folderTreeIds(int $folderId): array
    {
        $sql = 'WITH RECURSIVE folder_tree AS (
                SELECT id FROM experiments_folders WHERE id = :folder_id AND team = :team
                UNION ALL
                SELECT child.id FROM experiments_folders AS child
                INNER JOIN folder_tree ON child.parent_id = folder_tree.id
                WHERE child.team = :child_team
            ) SELECT id FROM folder_tree';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
        $req->bindValue(':child_team', $this->requester->userData['team'], PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_map('intval', array_column($req->fetchAll(), 'id'));
    }

    private function countItemsInTree(int $folderId): int
    {
        $ids = $this->folderTreeIds($folderId);
        if ($ids === array()) {
            return 0;
        }
        $in = implode(',', $ids);
        $total = 0;
        foreach (array('experiments', 'items') as $table) {
            $req = $this->Db->prepare(sprintf('SELECT COUNT(*) FROM %s WHERE folder_id IN (%s) AND team = :team AND state = 1', $table, $in));
            $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
            $this->Db->execute($req);
            $total += (int) $req->fetchColumn();
        }
        return $total;
    }

    private function storePermissions(int $folderId, int $canreadBase, string $canread, int $canwriteBase, string $canwrite): void
    {
        $sql = 'INSERT INTO custom_experiment_folder_permissions (folder_id, canread_base, canwrite_base, canread, canwrite, updated_by)
            VALUES (:folder_id, :canread_base, :canwrite_base, :canread, :canwrite, :updated_by)
            ON DUPLICATE KEY UPDATE canread_base = VALUES(canread_base), canwrite_base = VALUES(canwrite_base),
                canread = VALUES(canread), canwrite = VALUES(canwrite), updated_by = VALUES(updated_by)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':folder_id', $folderId, PDO::PARAM_INT);
        $req->bindValue(':canread_base', $canreadBase, PDO::PARAM_INT);
        $req->bindValue(':canwrite_base', $canwriteBase, PDO::PARAM_INT);
        $req->bindValue(':canread', $canread);
        $req->bindValue(':canwrite', $canwrite);
        $req->bindValue(':updated_by', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function copyStoredPermissions(int $fromFolderId, int $toFolderId): void
    {
        $sql = 'INSERT INTO custom_experiment_folder_permissions (folder_id, canread_base, canwrite_base, canread, canwrite, updated_by)
            SELECT :to_id, canread_base, canwrite_base, canread, canwrite, :updated_by
            FROM custom_experiment_folder_permissions WHERE folder_id = :from_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':to_id', $toFolderId, PDO::PARAM_INT);
        $req->bindValue(':from_id', $fromFolderId, PDO::PARAM_INT);
        $req->bindValue(':updated_by', $this->requester->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    /**
     * Remember the permissions on a folder (and its subfolders when asked) and replace the permissions of
     * every item already in it. Items the requester cannot edit (not their own, immutable permissions,
     * archived or in exclusive edit by someone else) are left as they are and counted as skipped.
     *
     * @param array<string, mixed> $params
     */
    private function setFolderPermissions(array $params): array
    {
        $folder = $this->readOne();
        if (!$this->canManagePermissions((int) $folder['userid'])) {
            throw new IllegalActionException();
        }
        $canreadBase = Check::basePermission((int) ($params['canread_base'] ?? 0))->value;
        $canwriteBase = Check::basePermission((int) ($params['canwrite_base'] ?? 0))->value;
        $empty = '{"teams":[],"teamgroups":[],"users":[]}';
        $canread = Check::visibility((string) ($params['canread'] ?? $empty));
        $canwrite = Check::visibility((string) ($params['canwrite'] ?? $empty));
        foreach (array($canread, $canwrite) as $json) {
            $wanted = json_decode($json, true) ?? array();
            $found = $this->existingTargets($wanted);
            foreach (array('teams', 'teamgroups', 'users') as $key) {
                if (count(array_unique(array_map('intval', (array) ($wanted[$key] ?? array())))) !== count($found[$key])) {
                    throw new ImproperActionException(_('The permissions refer to a team, user group or user that does not exist.'));
                }
            }
        }
        $includeSubfolders = filter_var($params['include_subfolders'] ?? true, FILTER_VALIDATE_BOOLEAN);
        $folderIds = $includeSubfolders ? $this->folderTreeIds((int) $this->id) : array((int) $this->id);

        foreach ($folderIds as $folderId) {
            $this->storePermissions($folderId, $canreadBase, $canread, $canwriteBase, $canwrite);
        }

        $result = array('updated' => 0, 'skipped' => 0);
        $in = implode(',', $folderIds);
        $payload = array(
            'canread_base' => $canreadBase,
            'canread' => $canread,
            'canwrite_base' => $canwriteBase,
            'canwrite' => $canwrite,
        );
        foreach (array('experiments' => Experiments::class, 'items' => Items::class) as $table => $entityClass) {
            // normal and archived items; archived ones cannot be changed and are counted as skipped
            $req = $this->Db->prepare(sprintf('SELECT id FROM %s WHERE folder_id IN (%s) AND team = :team AND state IN (1, 2)', $table, $in));
            $req->bindValue(':team', $this->requester->userData['team'], PDO::PARAM_INT);
            $this->Db->execute($req);
            foreach (array_column($req->fetchAll(), 'id') as $entityId) {
                if ($this->patchEntityPermissions($entityClass, (int) $entityId, $payload)) {
                    $result['updated']++;
                } else {
                    $result['skipped']++;
                }
            }
        }
        $folder = $this->readOne();
        $folder['permission_apply_result'] = $result;
        return $folder;
    }

    /**
     * Give an item the permissions of the folder it was just filed in (nothing happens if the folder
     * remembers none, or if the requester may not change the item).
     */
    public function applyFolderPermissionsToEntity(string $entityClass, int $entityId, int $folderId): void
    {
        $permissions = $this->readPermissions($folderId);
        if ($permissions === null) {
            return;
        }
        // someone deleted since the permissions were remembered is simply left out
        $this->patchEntityPermissions($entityClass, $entityId, array(
            'canread_base' => $permissions['canread_base'],
            'canread' => (string) json_encode($this->existingTargets($permissions['canread'])),
            'canwrite_base' => $permissions['canwrite_base'],
            'canwrite' => (string) json_encode($this->existingTargets($permissions['canwrite'])),
        ));
    }

    /**
     * Keep only the teams, user groups and users that still exist.
     *
     * @param array<string, mixed> $can
     * @return array{teams: array<int>, teamgroups: array<int>, users: array<int>}
     */
    private function existingTargets(array $can): array
    {
        $tables = array('teams' => array('teams', 'id'), 'teamgroups' => array('team_groups', 'id'), 'users' => array('users', 'userid'));
        $result = array('teams' => array(), 'teamgroups' => array(), 'users' => array());
        foreach ($tables as $key => $definition) {
            $ids = array_values(array_unique(array_map('intval', (array) ($can[$key] ?? array()))));
            if ($ids === array()) {
                continue;
            }
            $req = $this->Db->prepare(sprintf('SELECT %2$s FROM %1$s WHERE %2$s IN (%3$s)', $definition[0], $definition[1], implode(',', $ids)));
            $this->Db->execute($req);
            $result[$key] = array_map('intval', array_column($req->fetchAll(), $definition[1]));
        }
        return $result;
    }

    /**
     * Same code path as editing the permissions of one item by hand (checks, changelog, notifications).
     * Returns false when the requester is not allowed to change this item.
     *
     * @param class-string<AbstractEntity> $entityClass
     * @param array<string, mixed> $payload
     */
    private function patchEntityPermissions(string $entityClass, int $entityId, array $payload): bool
    {
        try {
            $entity = new $entityClass($this->requester, $entityId);
            // Decide before changing anything, so an item is never left with only part of the new permissions:
            // archived items and items with locked permissions (unless the requester is an admin) are skipped.
            if ((int) ($entity->entityData['state'] ?? 1) !== 1) {
                return false;
            }
            $locked = (int) ($entity->entityData['canread_is_immutable'] ?? 0) === 1
                || (int) ($entity->entityData['canwrite_is_immutable'] ?? 0) === 1;
            if ($locked && !$this->requester->isAdmin()) {
                return false;
            }
            $entity->patch(Action::Update, $payload);
            return true;
        } catch (IllegalActionException | UnprocessableContentException | ImproperActionException | ResourceNotFoundException) {
            return false;
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
