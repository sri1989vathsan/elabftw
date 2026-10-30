<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2026 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\EntitySqlBuilder;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\State;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Override;
use PDO;

use function sprintf;

/**
 * Read-only feed of the changes made to the resources or registry entries the requester can read, newest first
 */
final class ActivityLog extends AbstractRest
{
    private const int DEFAULT_LIMIT = 500;

    private const int MAX_LIMIT = 5000;

    public function __construct(
        private Users $Users,
        private string $searchTerm = '',
        private int $userid = 0,
        private int $category = 0,
        private int $limit = 0,
        private EntityType $type = EntityType::Items,
    ) {
        parent::__construct();
        $this->limit = $this->limit <= 0 ? self::DEFAULT_LIMIT : min($this->limit, self::MAX_LIMIT);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/activity/';
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = sprintf(
            "SELECT ch.id, ch.created_at, ch.target, ch.content, ch.users_id AS userid,
                    CONCAT(actor.firstname, ' ', actor.lastname) AS fullname,
                    entity.id AS entity_id, entity.title, entity.category,
                    cat.title AS category_title, cat.color AS category_color
                FROM %1\$s_changelog AS ch
                JOIN %1\$s AS entity ON (entity.id = ch.entity_id)
                LEFT JOIN users ON (entity.userid = users.userid)
                LEFT JOIN users2teams ON (users2teams.users_id = users.userid AND users2teams.teams_id = :teamid)
                LEFT JOIN users AS actor ON (actor.userid = ch.users_id)
                LEFT JOIN %2\$s AS cat ON (cat.id = entity.category)
                WHERE entity.state <> :state_deleted
                %3\$s %4\$s %5\$s %6\$s
                ORDER BY ch.created_at DESC, ch.id DESC
                LIMIT :limit",
            $this->type->value,
            $this->type->toCategoryTable(),
            (new EntitySqlBuilder($this->type->toInstance($this->Users)))->getCanFilter('canread'),
            $this->userid > 0 ? 'AND ch.users_id = :actor_id' : '',
            $this->category > 0 ? 'AND entity.category = :category' : '',
            $this->searchTerm !== '' ? 'AND (entity.title LIKE :search OR ch.target LIKE :search OR ch.content LIKE :search)' : '',
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':state_deleted', State::Deleted->value, PDO::PARAM_INT);
        $req->bindParam(':teamid', $this->Users->userData['team'], PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':limit', $this->limit, PDO::PARAM_INT);
        if ($this->userid > 0) {
            $req->bindValue(':actor_id', $this->userid, PDO::PARAM_INT);
        }
        if ($this->category > 0) {
            $req->bindValue(':category', $this->category, PDO::PARAM_INT);
        }
        if ($this->searchTerm !== '') {
            $req->bindValue(':search', '%' . $this->searchTerm . '%');
        }
        $this->Db->execute($req);

        return $req->fetchAll();
    }
}
