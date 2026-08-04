<?php

/**
 * @author eLabFTW contributors
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function _;
use function in_array;
use function sprintf;

/**
 * Experiment and resource categories favorited by a user.
 */
final class FavCategories extends AbstractRest
{
    use SetIdTrait;

    private const string EXPERIMENTS = 'experiments';

    private const string RESOURCES = 'resources';

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/favcategories/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $categoryId = Filter::intOrNull($reqBody['category_id'] ?? 0)
            ?? throw new ImproperActionException(_('Please select a category.'));
        $categoryType = $this->getCategoryType($reqBody['category_type'] ?? '');
        $table = $this->getCategoryTable($categoryType);

        $sql = sprintf('SELECT id FROM %s WHERE id = :category_id AND team = :team', $table);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':category_id', $categoryId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if (!$req->fetchColumn()) {
            throw new ImproperActionException(_('Could not find category.'));
        }

        $sql = 'INSERT INTO favcategories2users (users_id, category_type, category_id)
            VALUES (:users_id, :category_type, :category_id)
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindParam(':category_type', $categoryType);
        $req->bindParam(':category_id', $categoryId, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = "SELECT fav.id, fav.category_id, fav.category_type, cat.title, cat.color
            FROM favcategories2users AS fav
            INNER JOIN experiments_categories AS cat
                ON fav.category_type = 'experiments' AND fav.category_id = cat.id
            WHERE fav.users_id = :experiments_users_id AND cat.team = :experiments_team
            UNION ALL
            SELECT fav.id, fav.category_id, fav.category_type, cat.title, cat.color
            FROM favcategories2users AS fav
            INNER JOIN items_categories AS cat
                ON fav.category_type = 'resources' AND fav.category_id = cat.id
            WHERE fav.users_id = :resources_users_id AND cat.team = :resources_team
            ORDER BY category_type, title";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':experiments_users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':experiments_team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':resources_users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':resources_team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE FROM favcategories2users WHERE id = :id AND users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function getCategoryType(string $categoryType): string
    {
        if (!in_array($categoryType, array(self::EXPERIMENTS, self::RESOURCES), true)) {
            throw new ImproperActionException(_('Invalid category type.'));
        }
        return $categoryType;
    }

    private function getCategoryTable(string $categoryType): string
    {
        return $categoryType === self::EXPERIMENTS ? 'experiments_categories' : 'items_categories';
    }
}
