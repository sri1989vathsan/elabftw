<?php

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Enums\BasePermissions;
use Elabftw\Models\Users\AuthenticatedUser;
use Elabftw\Traits\TestsUtilsTrait;

use function array_column;
use function array_map;

final class ExperimentsFoldersTest extends \PHPUnit\Framework\TestCase
{
    use TestsUtilsTrait;

    public function testFolderResultsRespectEntityReadPermissions(): void
    {
        $owner = $this->getRandomUserInTeam(1);
        $viewer = $this->getRandomUserInTeam(1);
        while ($viewer->userid === $owner->userid) {
            $viewer = $this->getRandomUserInTeam(1);
        }
        $OwnerFolders = new ExperimentsFolders($owner);
        $folderId = $OwnerFolders->create('Permission regression folder');

        $private = $this->getFreshExperimentWithGivenUser($owner);
        $private->patch(Action::Update, array(
            'folder_id' => $folderId,
            'canread_base' => BasePermissions::UserOnly->value,
        ));
        $teamVisible = $this->getFreshExperimentWithGivenUser($owner);
        $teamVisible->patch(Action::Update, array(
            'folder_id' => $folderId,
            'canread_base' => BasePermissions::Team->value,
        ));

        $visibleIds = array_map('intval', array_column(
            (new ExperimentsFolders($viewer))->readExperimentsInFolder($folderId),
            'id',
        ));
        $this->assertNotContains($private->id, $visibleIds);
        $this->assertContains($teamVisible->id, $visibleIds);
    }

    public function testFolderHierarchyIsLimitedToTheCurrentTeam(): void
    {
        $teamOne = $this->getRandomUserInTeam(1);
        $teamTwoId = (new Teams($teamOne))->create('Folder isolation team');
        $teamTwo = new AuthenticatedUser($teamOne->userid, $teamTwoId);
        $teamOneFolder = (new ExperimentsFolders($teamOne))->create('Team one folder');
        $teamTwoFolder = (new ExperimentsFolders($teamTwo))->create('Team two folder');

        $ids = array_map('intval', array_column(
            (new ExperimentsFolders($teamOne))->readHierarchyRows(),
            'id',
        ));
        $this->assertContains($teamOneFolder, $ids);
        $this->assertNotContains($teamTwoFolder, $ids);
    }
}
