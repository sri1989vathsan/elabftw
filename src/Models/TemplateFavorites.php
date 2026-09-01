<?php

/**
 * @copyright 2026 eLabFTW contributors
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

/**
 * Experiment templates starred by a user, for the "Insert template" picker
 * in the editor (see TemplateInsertExtension.ts).
 */
final class TemplateFavorites extends AbstractRest
{
    use SetIdTrait;

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/templatefavorites/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $templateId = Filter::intOrNull($reqBody['template_id'] ?? 0)
            ?? throw new ImproperActionException(_('Please select a template.'));

        $sql = 'SELECT id FROM experiments_templates WHERE id = :template_id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':template_id', $templateId, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if (!$req->fetchColumn()) {
            throw new ImproperActionException(_('Could not find template.'));
        }

        $sql = 'INSERT INTO custom_template_favorites (users_id, template_id)
            VALUES (:users_id, :template_id)
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindParam(':template_id', $templateId, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->lastInsertId();
    }

    /** Template ids favorited by this user. */
    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT template_id FROM custom_template_favorites WHERE users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        $this->Db->execute($req);

        return $req->fetchAll(PDO::FETCH_COLUMN);
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE FROM custom_template_favorites WHERE template_id = :template_id AND users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':template_id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':users_id', $this->Users->userData['userid'], PDO::PARAM_INT);
        return $this->Db->execute($req);
    }
}
