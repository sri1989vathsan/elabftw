<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

/**
 * Read-only access to a template's permanent version history (see
 * TemplateVersions::create() / custom_template_versions), for the version
 * picker in the "Insert template" editor dialog (TemplateInsertExtension.ts).
 */
final class TemplateVersionsRest extends AbstractRest
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
        return 'api/v2/templateversions/';
    }

    /** Version history (most recent first) for the template whose id is in the url. */
    #[Override]
    public function readOne(): array
    {
        $sql = 'SELECT id FROM experiments_templates WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        if (!$req->fetchColumn()) {
            throw new ResourceNotFoundException();
        }

        return TemplateVersions::readAllForEntity($this->id);
    }
}
