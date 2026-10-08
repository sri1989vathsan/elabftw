<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Controllers;

use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Services\WhatsNewStore;
use Override;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;

use function _;
use function array_column;
use function array_filter;
use function array_map;
use function array_merge;
use function array_slice;
use function array_unique;
use function array_values;
use function checkdate;
use function explode;
use function is_numeric;
use function mb_substr;
use function preg_match;
use function preg_replace;
use function random_bytes;
use function bin2hex;
use function str_replace;
use function strtolower;
use function trim;

/**
 * Lists the newest features of this installation. Team admins and sysadmins
 * can edit the entries, add new ones and attach pictures; see WhatsNewStore for
 * where the changes are kept.
 */
final class WhatsNewController extends AbstractHtmlController
{
    private const int MAX_DETAILS = 12;

    private WhatsNewStore $Store;

    #[Override]
    public function getResponse(): Response
    {
        if ($this->app->isAnonymous()) {
            throw new UnauthorizedException();
        }
        $this->Store ??= new WhatsNewStore();

        $image = $this->app->Request->query->getString('image');
        if ($image !== '') {
            return $this->imageResponse($image);
        }
        if ($this->app->Request->getMethod() === 'POST') {
            return $this->handlePost();
        }

        return parent::getResponse();
    }

    #[Override]
    protected function getTemplate(): string
    {
        return 'whats-new.html';
    }

    #[Override]
    protected function getPageTitle(): string
    {
        return _('What\'s new');
    }

    #[Override]
    protected function getData(): array
    {
        $entries = $this->Store->all();
        // The template draws its own heading (with an icon); hide the base one.
        return array_merge(parent::getData(), array(
            'hideTitle' => true,
            'whatsNewEntries' => $entries,
            'whatsNewAreas' => array_values(array_unique(array_filter(array_column($entries, 'area')))),
            'whatsNewCanEdit' => $this->canEdit(),
        ));
    }

    private function canEdit(): bool
    {
        return $this->app->Users->isAdmin || (int) ($this->app->Users->userData['is_sysadmin'] ?? 0) === 1;
    }

    private function imageResponse(string $name): Response
    {
        $path = $this->Store->imagePath($name);
        if ($path === null) {
            throw new ResourceNotFoundException();
        }
        $response = new BinaryFileResponse($path);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        // The file name changes whenever a picture is replaced, so it can be cached.
        $response->setPublic();
        $response->setMaxAge(86400);

        return $response;
    }

    private function handlePost(): Response
    {
        if (!$this->canEdit()) {
            throw new UnauthorizedException();
        }
        $request = $this->app->Request->request;
        try {
            $action = $request->getString('action');
            if ($action === 'delete') {
                $id = $this->cleanId($request->getString('id'));
                if ($id === '') {
                    throw new ImproperActionException(_('Nothing to delete.'));
                }
                $this->Store->delete($id);
                $this->app->Session->getFlashBag()->add('ok', _('Entry deleted'));

                return new RedirectResponse('whats-new.php');
            }
            if ($action !== 'save') {
                throw new ImproperActionException(_('Unknown action.'));
            }
            $file = $this->app->Request->files->get('image');
            $id = $this->Store->save(
                $this->buildEntry(),
                $file instanceof UploadedFile && $file->getError() !== UPLOAD_ERR_NO_FILE ? $file : null,
                $request->getBoolean('remove_image'),
            );
            $this->app->Session->getFlashBag()->add('ok', _('Saved'));

            return new RedirectResponse('whats-new.php#whats-new-' . $id);
        } catch (ImproperActionException $e) {
            $this->app->Session->getFlashBag()->add('ko', $e->getMessage());

            return new RedirectResponse('whats-new.php');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function buildEntry(): array
    {
        $request = $this->app->Request->request;
        $title = $this->oneLine($request->getString('title'), 120);
        if ($title === '') {
            throw new ImproperActionException(_('Give the entry a title.'));
        }
        $date = trim($request->getString('date'));
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new ImproperActionException(_('Enter a valid date.'));
        }
        $id = $this->cleanId($request->getString('id'));
        if ($id === '') {
            $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($title)), '-');
            $id = mb_substr($slug === '' ? 'entry' : $slug, 0, 40) . '-' . bin2hex(random_bytes(2));
        }
        $details = array_slice(array_values(array_filter(array_map(
            fn(string $line): string => $this->oneLine($line, 300),
            explode("\n", str_replace("\r", '', $request->getString('details'))),
        ), static fn(string $line): bool => $line !== '')), 0, self::MAX_DETAILS);

        $entry = array(
            'id' => $id,
            'date' => $date,
            'area' => $this->oneLine($request->getString('area'), 40),
            'title' => $title,
            'summary' => $this->oneLine($request->getString('summary'), 400),
            'details' => $details,
            'imageAlt' => $this->oneLine($request->getString('imageAlt'), 200),
        );
        $highlight = $this->buildHighlight();
        if ($highlight !== null) {
            $entry['highlight'] = $highlight;
        }

        return $entry;
    }

    /**
     * The outline drawn on the picture, as percentages of the picture; none when left empty.
     *
     * @return array<string, mixed>|null
     */
    private function buildHighlight(): ?array
    {
        $request = $this->app->Request->request;
        $values = array();
        foreach (array('x', 'y', 'w', 'h') as $key) {
            $raw = trim($request->getString('highlight_' . $key));
            if ($raw === '') {
                return null;
            }
            if (!is_numeric($raw) || (float) $raw < 0 || (float) $raw > 100) {
                throw new ImproperActionException(_('The outline values must be between 0 and 100.'));
            }
            $values[$key] = round((float) $raw, 1);
        }
        if ($values['w'] <= 0 || $values['h'] <= 0) {
            return null;
        }
        $values['label'] = $this->oneLine($request->getString('highlight_label'), 80);

        return $values;
    }

    private function cleanId(string $id): string
    {
        $id = trim($id);

        return preg_match('/^[a-z0-9][a-z0-9-]{0,59}$/', $id) === 1 ? $id : '';
    }

    private function oneLine(string $text, int $max): string
    {
        return mb_substr(trim((string) preg_replace('/\s+/u', ' ', $text)), 0, $max);
    }
}
