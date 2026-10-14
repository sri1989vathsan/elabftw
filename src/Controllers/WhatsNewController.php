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
use function is_array;
use function is_numeric;
use function mb_substr;
use function preg_match;
use function pathinfo;
use function preg_replace;
use function random_bytes;
use function bin2hex;
use function count;
use function in_array;
use function str_replace;
use function strtolower;
use function trim;
use function usort;

/**
 * Lists the newest features of this installation. Sysadmins can edit the
 * entries, add new ones and attach pictures; see WhatsNewStore for where the
 * changes are kept.
 */
final class WhatsNewController extends AbstractHtmlController
{
    private const int MAX_DETAILS = 40;

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
        $card = $this->app->Request->query->getString('card');
        if ($card !== '') {
            return $this->cardResponse($card);
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
        return _('MoorLab eLabFTW guide');
    }

    #[Override]
    protected function getData(): array
    {
        $all = $this->Store->all();
        // The page is the guide: one card per feature. ?all=1 lists every update, newest first ("What's new").
        $showAll = $this->app->Request->query->getString('all') === '1';
        $guide = array_values(array_filter($all, static fn(array $e): bool => !empty($e['guide'])));
        usort($guide, static fn(array $a, array $b): int => ((int) ($a['order'] ?? 999)) <=> ((int) ($b['order'] ?? 999)));
        $entries = $showAll ? $all : $guide;
        // The template draws its own heading (with an icon); hide the base one.
        return array_merge(parent::getData(), array(
            'hideTitle' => true,
            'whatsNewEntries' => $entries,
            'whatsNewShowAll' => $showAll,
            'whatsNewTotal' => count($all),
            // Filter chips only for the areas that are on show; the editor suggests every area.
            'whatsNewChips' => array_values(array_unique(array_filter(array_column($entries, 'area')))),
            // ?area=Experiments opens the guide already showing one group of cards (only a real, listed area counts)
            'whatsNewActiveArea' => !$showAll && in_array($this->app->Request->query->getString('area'), array_column($entries, 'area'), true)
                ? $this->app->Request->query->getString('area')
                : '',
            'whatsNewAreas' => array_values(array_unique(array_filter(array_column($all, 'area')))),
            'whatsNewCanEdit' => $this->canEdit(),
        ));
    }

    /** Only sysadmins edit; team admins and everyone else just read. */
    private function canEdit(): bool
    {
        return (int) ($this->app->Users->userData['is_sysadmin'] ?? 0) === 1;
    }

    /** Just the popup of one guide card, for the "i" buttons placed next to features across the app. */
    private function cardResponse(string $id): Response
    {
        foreach ($this->Store->all() as $entry) {
            if (($entry['id'] ?? '') === $id && !empty($entry['guide'])) {
                $response = new Response($this->app->render('guide-modal.html', array(
                    'entry' => $entry,
                    'whatsNewCanEdit' => false,
                )));
                $response->prepare($this->app->Request);

                return $response;
            }
        }
        throw new ResourceNotFoundException();
    }

    /**
     * The further screenshots already on the entry, as the form sent them back (caption edited, or marked for removal).
     *
     * @return list<array{image: string, caption: string, remove?: bool}>
     */
    private function extraScreenshotsFromForm(): array
    {
        $rows = $this->app->Request->request->all('extra');
        $out = array();
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $out[] = array(
                'image' => (string) ($row['image'] ?? ''),
                'caption' => (string) ($row['caption'] ?? ''),
                'remove' => !empty($row['remove']),
            );
        }

        return $out;
    }

    /** @return list<UploadedFile> further screenshots chosen in the form (several at once) */
    private function newExtraScreenshots(): array
    {
        $files = $this->app->Request->files->get('extra_image');
        $files = is_array($files) ? $files : array($files);
        $out = array();
        foreach ($files as $file) {
            if ($file instanceof UploadedFile && $file->getError() !== UPLOAD_ERR_NO_FILE) {
                $out[] = $file;
            }
        }

        return $out;
    }

    private function imageResponse(string $name): Response
    {
        $path = $this->Store->imagePath($name);
        if ($path === null) {
            throw new ResourceNotFoundException();
        }
        $response = new BinaryFileResponse($path);
        // Say what it is: the file's own type, not the page default.
        $response->headers->set('Content-Type', match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            default => 'image/jpeg',
        });
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
                $this->extraScreenshotsFromForm(),
                $this->newExtraScreenshots(),
            );
            $this->app->Session->getFlashBag()->add('ok', _('Saved'));

            // An entry that is not featured only shows in the full list.
            $page = $request->getBoolean('featured') ? 'whats-new.php' : 'whats-new.php?all=1';

            return new RedirectResponse($page . '#whats-new-' . $id);
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
        $details = $this->lines($request->getString('details'), self::MAX_DETAILS, 700);

        $entry = array(
            'id' => $id,
            'date' => $date,
            'area' => $this->oneLine($request->getString('area'), 40),
            'title' => $title,
            'summary' => $this->oneLine($request->getString('summary'), 400),
            'details' => $details,
            'imageAlt' => $this->oneLine($request->getString('imageAlt'), 200),
            'featured' => $request->getBoolean('featured'),
            // The guide: a card per feature with what it is for, how it works, how to use it and what is new.
            'guide' => $request->getBoolean('guide'),
            'order' => max(0, min(999, (int) $request->getString('order'))),
            'icon' => preg_match('/^fa-[a-z0-9-]{1,40}$/', trim($request->getString('icon'))) === 1 ? trim($request->getString('icon')) : '',
            'purpose' => $this->oneLine($request->getString('purpose'), 400),
            'uses' => $this->lines($request->getString('uses'), 14, 500),
            'news' => $this->oneLine($request->getString('news'), 400),
            'shot' => $this->oneLine($request->getString('shot'), 200),
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

    /**
     * @return array<int, string> one cleaned line per non-empty line, at most $max of them
     */
    private function lines(string $text, int $max, int $length): array
    {
        return array_slice(array_values(array_filter(array_map(
            fn(string $line): string => $this->oneLine($line, $length),
            explode("\n", str_replace("\r", '', $text)),
        ), static fn(string $line): bool => $line !== '')), 0, $max);
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
