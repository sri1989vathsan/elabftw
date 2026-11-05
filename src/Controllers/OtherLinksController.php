<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\OtherLinks;
use Override;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;

use function _;

/** Links > Others: a table of links that anybody in the team can add to. */
final class OtherLinksController extends AbstractHtmlController
{
    #[Override]
    public function getResponse(): Response
    {
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }
        if ($this->app->Request->getMethod() === 'POST') {
            return $this->handlePost();
        }
        return parent::getResponse();
    }

    #[Override]
    protected function getTemplate(): string
    {
        return 'other-links.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('Other links');
    }

    #[Override]
    protected function getData(): array
    {
        $isAdmin = (int) ($this->app->Users->userData['is_admin'] ?? 0) === 1 || (int) ($this->app->Users->userData['is_sysadmin'] ?? 0) === 1;
        return array_merge(parent::getData(), array(
            'otherLinks' => new OtherLinks($this->app->Users)->readAll(),
            'otherLinksIsAdmin' => $isAdmin,
        ));
    }

    private function handlePost(): Response
    {
        $request = $this->app->Request->request;
        $Links = new OtherLinks($this->app->Users);
        $flash = $this->app->Session->getFlashBag();
        try {
            $action = $request->getString('action');
            if ($action === 'add') {
                $Links->create($request->getString('title'), $request->getString('url'), $request->getString('description'));
                $flash->add('ok', _('Link added'));
            } elseif ($action === 'delete') {
                $Links->destroy($request->getInt('id'));
                $flash->add('ok', _('Link removed'));
            } else {
                throw new ImproperActionException(_('Unknown action.'));
            }
        } catch (ImproperActionException $e) {
            $flash->add('ko', $e->getMessage());
        }
        return new RedirectResponse('other-links.php');
    }
}
