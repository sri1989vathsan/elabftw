<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Elabftw\FeatureFlags;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\PyratLinks;
use Elabftw\Services\Pyrat\PyratAccess;
use Elabftw\Services\Pyrat\PyratClient;
use Override;

use function array_merge;
use function in_array;
use function _;

final class AnimalStudiesController extends AbstractHtmlController
{
    #[Override]
    protected function getTemplate(): string
    {
        return 'animal-studies.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Animal Studies');
    }

    #[Override]
    protected function getData(): array
    {
        if (!FeatureFlags::ANIMAL_STUDIES) {
            throw new ResourceNotFoundException();
        }
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }
        PyratAccess::assertAllowed($this->app->Users, $this->app->Config->configArr);
        $tab = $this->app->Request->query->getString('tab', 'animals');
        if (!in_array($tab, array('animals', 'cages', 'links', 'scoresheet'), true)) {
            $tab = 'animals';
        }

        $Pyrat = new PyratClient();
        $status = $Pyrat->getStatus();
        $animals = array();
        $cages = array();
        $links = array();
        $error = '';

        try {
            if ($tab === 'animals') {
                $animals = $Pyrat->searchAnimals(array(
                    'q' => $this->app->Request->query->getString('q'),
                    'cage' => $this->app->Request->query->getString('cage'),
                    'status' => $this->app->Request->query->getString('status'),
                ));
                foreach ($animals as &$animal) {
                    $animal['scoresheet_url'] = $Pyrat->getScoresheetUrl('animal', (string) ($animal['id'] ?? ''));
                }
                unset($animal);
            } elseif ($tab === 'cages') {
                $cages = $Pyrat->searchCages(array(
                    'q' => $this->app->Request->query->getString('q'),
                ));
                foreach ($cages as &$cage) {
                    $cage['scoresheet_url'] = $Pyrat->getScoresheetUrl('cage', (string) ($cage['id'] ?? ''));
                }
                unset($cage);
            } elseif ($tab === 'links') {
                $links = new PyratLinks($this->app->Users)->readAccessible();
                foreach ($links as &$link) {
                    $link['scoresheet_url'] = $Pyrat->getScoresheetUrl(
                        (string) $link['entity_type'],
                        (string) $link['pyrat_entity_id'],
                    );
                }
                unset($link);
            }
        } catch (\Throwable $e) {
            $error = $e->getMessage();
        }

        return array_merge(parent::getData(), array(
            'tab' => $tab,
            'pyratStatus' => $status,
            'animals' => $animals,
            'cages' => $cages,
            'pyratLinks' => $links,
            'pyratError' => $error,
            'scoresheetUrl' => $Pyrat->getScoresheetHomeUrl(),
        ));
    }
}
