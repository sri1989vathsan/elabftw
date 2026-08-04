<?php

/**
 * @author eLabFTW contributors
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
 * Per-user favorite owner and status filters.
 */
final class FavFilters extends AbstractRest
{
    use SetIdTrait;

    private const string OWNER = 'owner';

    private const string STATUS = 'status';

    private const string ALL = 'all';

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
        return 'api/v2/favfilters/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $filterType = $this->getFilterType($reqBody['filter_type'] ?? '');
        $targetType = $this->getTargetType($filterType, $reqBody['target_type'] ?? '');
        $targetId = Filter::intOrNull($reqBody['target_id'] ?? 0)
            ?? throw new ImproperActionException(_('Please select a filter value.'));

        $this->validateTarget($filterType, $targetType, $targetId);

        $sql = 'INSERT INTO favfilters2users (users_id, filter_type, target_type, target_id)
            VALUES (:users_id, :filter_type, :target_type, :target_id)
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindParam(':filter_type', $filterType);
        $req->bindParam(':target_type', $targetType);
        $req->bindParam(':target_id', $targetId, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = "SELECT fav.id, fav.filter_type, fav.target_type, fav.target_id,
                TRIM(CONCAT(owner.firstname, ' ', owner.lastname)) AS title, NULL AS color
            FROM favfilters2users AS fav
            INNER JOIN users AS owner ON owner.userid = fav.target_id
            INNER JOIN users2teams AS owner_team
                ON owner_team.users_id = owner.userid AND owner_team.teams_id = :owner_team
            WHERE fav.users_id = :owner_users_id AND fav.filter_type = 'owner'
            UNION ALL
            SELECT fav.id, fav.filter_type, fav.target_type, fav.target_id,
                status.title, status.color
            FROM favfilters2users AS fav
            INNER JOIN experiments_status AS status
                ON fav.target_type = 'experiments' AND fav.target_id = status.id
            WHERE fav.users_id = :experiments_users_id
                AND fav.filter_type = 'status' AND status.team = :experiments_team
            UNION ALL
            SELECT fav.id, fav.filter_type, fav.target_type, fav.target_id,
                status.title, status.color
            FROM favfilters2users AS fav
            INNER JOIN items_status AS status
                ON fav.target_type = 'resources' AND fav.target_id = status.id
            WHERE fav.users_id = :resources_users_id
                AND fav.filter_type = 'status' AND status.team = :resources_team
            ORDER BY filter_type, target_type, title";
        $req = $this->Db->prepare($sql);
        $req->bindValue(':owner_users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':owner_team', $this->Users->team, PDO::PARAM_INT);
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
        $sql = 'DELETE FROM favfilters2users WHERE id = :id AND users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function getFilterType(string $filterType): string
    {
        if (!in_array($filterType, array(self::OWNER, self::STATUS), true)) {
            throw new ImproperActionException(_('Invalid favorite filter type.'));
        }
        return $filterType;
    }

    private function getTargetType(string $filterType, string $targetType): string
    {
        if ($filterType === self::OWNER) {
            return self::ALL;
        }
        if (!in_array($targetType, array(self::EXPERIMENTS, self::RESOURCES), true)) {
            throw new ImproperActionException(_('Invalid favorite filter target.'));
        }
        return $targetType;
    }

    private function validateTarget(string $filterType, string $targetType, int $targetId): void
    {
        if ($filterType === self::OWNER) {
            $sql = 'SELECT 1 FROM users2teams WHERE users_id = :target_id AND teams_id = :team';
        } else {
            $table = $targetType === self::EXPERIMENTS ? 'experiments_status' : 'items_status';
            $sql = sprintf('SELECT 1 FROM %s WHERE id = :target_id AND team = :team', $table);
        }
        $req = $this->Db->prepare($sql);
        $req->bindParam(':target_id', $targetId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if (!$req->fetchColumn()) {
            throw new ImproperActionException(_('Could not find filter value.'));
        }
    }
}
