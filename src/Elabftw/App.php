<?php

/**
 * @package   Elabftw\Elabftw
 * @author    Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @license   https://www.gnu.org/licenses/agpl-3.0.html AGPL-3.0
 * @see       https://www.elabftw.net Official website
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use Elabftw\Enums\Language;
use Elabftw\Enums\Messages;
use Elabftw\Enums\ThemeVariant;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\Users\AnonymousUser;
use Elabftw\Models\Users\AuthenticatedUser;
use Elabftw\Models\Config;
use Elabftw\Models\ExperimentsCategories;
use Elabftw\Models\ExperimentsFolders;
use Elabftw\Models\ExperimentsStatus;
use Elabftw\Models\FavCategories;
use Elabftw\Models\FavFilters;
use Elabftw\Models\FavTags;
use Elabftw\Models\ItemsStatus;
use Elabftw\Models\ResourcesCategories;
use Elabftw\Models\Notifications\UserNotifications;
use Elabftw\Models\Teams;
use Elabftw\Models\Users\Users;
use Elabftw\Services\WhatsNewPopup;
use Elabftw\Traits\TwigTrait;
use Exception;
use Monolog\Handler\ErrorLogHandler;
use Monolog\Logger;
use Psr\Log\LoggerInterface;
use RuntimeException;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\FlashBagAwareSessionInterface;

use function basename;
use function bindtextdomain;
use function dirname;
use function in_array;
use function intdiv;
use function putenv;
use function setlocale;
use function textdomain;
use function array_merge;
use function bind_textdomain_codeset;
use function sprintf;
use function time;

/**
 * This is a super class holding various global objects
 */
final class App
{
    use TwigTrait;

    /** @psalm-suppress PossiblyUnusedProperty this property is used in twig templates */
    public array $notifsArr = array();

    public array $experimentsCategoryArr = array();

    public array $experimentsStatusArr = array();

    public array $favoriteCategoriesArr = array();

    // The LabCollector connection (URL and API key) of the team settings in the admin panel. Hidden for now: set to true to show it again; nothing else
    // (the pages, the Tools menu entry, the data, the migrations) is touched by this switch.
    public bool $showLabcollector = false;

    private ?array $createFoldersCache = null;

    private ?array $whatsNewPopup = null;

    public array $favoriteFiltersArr = array();

    public array $favoriteFilterUsersArr = array();

    public array $favoriteTagsArr = array();

    public array $itemsCategoryArr = array();

    public array $itemsStatusArr = array();

    public Teams $Teams;

    private ?int $sessionExpiresAt = null;

    public function __construct(
        public Request $Request,
        public FlashBagAwareSessionInterface $Session,
        public Config $Config,
        public LoggerInterface $Log,
        public Users $Users,
        public bool $devMode = false,
        public bool $demoMode = false,
    ) {}

    public static function getDefaultLogger(): LoggerInterface
    {
        return new Logger('elabftw')->pushHandler(new ErrorLogHandler());
    }

    //-*-*-*-*-*-*-**-*-*-*-*-*-*-*-//
    //     _                 _      //
    //    | |__   ___   ___ | |_    //
    //    | '_ \ / _ \ / _ \| __|   //
    //    | |_) | (_) | (_) | |_    //
    //    |_.__/ \___/ \___/ \__|   //
    //                              //
    //-*-*-*-*-*-*-**-*-*-*-*-*-*-*-//
    public function boot(
        ?AnonymousUser $requestUser = null,
    ): void {
        $this->handleSessionExpiration();

        if ($requestUser !== null) {
            $this->loadUser($requestUser);
        } else {
            try {
                if (
                    $this->Session->has('is_auth')
                    && $this->Session->get('userid') !== 0
                ) {
                    $this->loadUser(new AuthenticatedUser(
                        $this->Session->get('userid'),
                        $this->Session->get('team'),
                    ));
                }
            } catch (IllegalActionException) {
                $this->Session->invalidate();
                throw new UnauthorizedException();
            }

            if ($this->Session->get('is_anon') === 1) {
                // anon user only has access to a subset of pages
                $allowedPages = array(
                    'ApiController.php',
                    'database.php',
                    'download.php',
                    'experiments.php',
                    'index.php',
                    'logout.php',
                    'make.php',
                );
                if (!in_array(basename($this->Request->getScriptName()), $allowedPages, true)) {
                    throw new UnauthorizedException();
                }

                $this->loadUser(new AnonymousUser(
                    $this->Session->get('team'),
                    Language::tryFrom($this->getLang()) ?? Language::EnglishGB,
                ));
            }
        }

        $this->Teams = new Teams($this->Users, $this->Users->team);
        if ($this->Users->team) {
            $ExperimentsCategory = new ExperimentsCategories($this->Teams);
            $this->experimentsCategoryArr = $ExperimentsCategory->readAll($ExperimentsCategory->getQueryParams(new InputBag(array('limit' => 9999))));
            $ResourcesCategory = new ResourcesCategories($this->Teams);
            $this->itemsCategoryArr = $ResourcesCategory->readAll($ResourcesCategory->getQueryParams(new InputBag(array('limit' => 9999))));
            $ExperimentsStatus = new ExperimentsStatus($this->Teams);
            $this->experimentsStatusArr = $ExperimentsStatus->readAll($ExperimentsStatus->getQueryParams(new InputBag(array('limit' => 9999))));
            $ItemsStatus = new ItemsStatus($this->Teams);
            $this->itemsStatusArr = $ItemsStatus->readAll($ItemsStatus->getQueryParams(new InputBag(array('limit' => 9999))));
            if ($this->Session->has('is_auth') && !$this->Session->get('is_anon')) {
                $this->favoriteCategoriesArr = new FavCategories($this->Users)->readAll();
                $this->favoriteFiltersArr = new FavFilters($this->Users)->readAll();
                // The complete team member list can be large. Load it only
                // when the favorites panel explicitly requests its options.
                if ($this->Request->query->getBoolean('load_filter_options')) {
                    $this->favoriteFilterUsersArr = $this->Users->readAllActiveFromTeam();
                }
                $this->favoriteTagsArr = new FavTags($this->Users)->readAll();
            }
        }
        $this->initi18n();
    }

    /**
     * The folders the "Create" dialog offers (experiments and resources share the tree), with the bookmarked ones. Read on first use and only for a
     * logged in user, so that every page can have the picker, not only the list pages whose controller passes the same data.
     *
     * @return array{rows: array<int, array<string, mixed>>, favoriteIds: array<int, int|string>}
     */
    public function getCreateFolders(): array
    {
        if ($this->createFoldersCache !== null) {
            return $this->createFoldersCache;
        }
        $this->createFoldersCache = array('rows' => array(), 'favoriteIds' => array());
        if ($this->Users->team && $this->Session->has('is_auth') && !$this->Session->get('is_anon')) {
            $Folders = new ExperimentsFolders($this->Users);
            $this->createFoldersCache = array('rows' => $Folders->readHierarchyRows(), 'favoriteIds' => $Folders->getFavoriteFolders());
        }
        return $this->createFoldersCache;
    }

    /**
     * What the "What's new" popup shows on this page load (empty: no popup). Only the first full page of a login session
     * can show it; it is decided here, on the server, so the page never flashes an empty popup.
     *
     * @return array<string, mixed>
     */
    public function getWhatsNewPopup(): array
    {
        if ($this->whatsNewPopup !== null) {
            return $this->whatsNewPopup;
        }
        $this->whatsNewPopup = array();
        if (!$this->Session->get('is_auth') || $this->isAnonymous() || $this->Session->get('whats_new_popup_done') === 1) {
            return $this->whatsNewPopup;
        }
        $this->Session->set('whats_new_popup_done', 1);
        try {
            $this->whatsNewPopup = new WhatsNewPopup((int) $this->Users->userData['userid'])->build();
        } catch (Exception $e) {
            $this->Log->error('What\'s new popup failed', array(array('Exception' => $e)));
        }
        return $this->whatsNewPopup;
    }

    /** Number of "What's new" entries the user has not seen yet (the dot on the navbar button); 0 when anonymous or on any failure. */
    public function getWhatsNewUnseenCount(): int
    {
        if (!$this->Session->get('is_auth') || $this->isAnonymous()) {
            return 0;
        }
        try {
            return new WhatsNewPopup((int) $this->Users->userData['userid'])->unseenCount();
        } catch (Exception) {
            return 0;
        }
    }

    /** Whether the user wants the "What's new" popup after login (a switch in their settings; on by default). */
    public function isWhatsNewPopupEnabled(): bool
    {
        return new WhatsNewPopup((int) $this->Users->userData['userid'])->isEnabled();
    }

    public function isAnonymous(): bool
    {
        return $this->Users instanceof AnonymousUser;
    }

    /**
     * Generate HTML from a twig template (in src/templates).
     * The App object is injected into every template as well as langsArr
     */
    public function render(string $template, array $variables): string
    {
        try {
            $globals = array(
                'App' => $this,
                'langsArr' => Language::getAllHuman(),
                'sessionExpiresAt' => $this->sessionExpiresAt,
            );
            return $this->getTwig($this->devMode)->render(
                $template,
                array_merge(
                    $globals,
                    $variables,
                )
            );
        } catch (RuntimeException $e) {
            echo '<h1>Error writing to twig cache directory. Check folder permissions.</h1>';
            echo '<h2>Error message: ' . $e->getMessage() . '</h2>';
            exit;
        }
    }

    /**
     * Get the lang of our current user
     */
    public function getLang(): string
    {
        // if we have an authenticated user, use their lang setting
        if ($this->Users instanceof AuthenticatedUser) {
            return $this->Users->userData['lang'];
        }
        // we can also set it in Session (even when anon)
        if ($this->Session->has('lang')) {
            return $this->Session->get('lang');
        }
        // default lang is the server configured one
        return $this->Config->configArr['lang'];
    }

    /** @psalm-suppress PossiblyUnusedMethod this method is used in twig templates */
    public function getJsLang(): string
    {
        $Language = Language::tryFrom($this->getLang()) ?? Language::EnglishGB;
        return $Language->toCalendar();
    }

    public static function getWhatsnewLink(int $installedVersionInt): string
    {
        // we want to have a version number like 50100 for 5.1, we do not care about the patch number
        $baseVersion = intdiv($installedVersionInt, 100) * 100;
        return sprintf('https://www.deltablot.com/posts/release-%d', $baseVersion);
    }

    public function getResponseFromException(Exception $e): Response
    {
        // generate a unique error so user can communicate this error to support and it's easy to find in the logs
        $errorIdent = Tools::getUuidv4();
        $this->Log->error('', array(array('userid' => $this->Session->get('userid'), 'error-identifier' => $errorIdent), array('Exception' => $e)));
        $template = 'error.html';
        $error = Messages::CriticalError;
        $renderArr = array('error' => sprintf('%s %s', $error->toHuman(), $errorIdent));
        $Response = new Response();
        $Response->setContent($this->render($template, $renderArr));
        $Response->setStatusCode($error->toHttpCode());
        return $Response;
    }

    public function getThemeVariant(): ThemeVariant
    {
        // 1. authenticated user preference
        if ($this->Users instanceof AuthenticatedUser) {
            return ThemeVariant::tryFrom((int) $this->Users->userData['theme_variant'])
                ?? ThemeVariant::Auto;
        }
        // 2. anon & guest preference (cookie)
        $cookie = $this->Request->cookies->getInt('theme_variant');
        return ThemeVariant::tryFrom($cookie) ?? ThemeVariant::Auto;
    }

    private function handleSessionExpiration(): void
    {
        if (!$this->Session->has('is_auth')) {
            return;
        }

        $autologoutTime = (int) $this->Config->configArr['autologout_time'];

        if ($autologoutTime <= 0) {
            $this->Session->remove('session_expires_at');
            return;
        }

        $now = time();
        $expiresAt = (int) ($this->Session->get('session_expires_at') ?? 0);

        if ($expiresAt !== 0 && $expiresAt <= $now) {
            $this->Session->invalidate();
            throw new UnauthorizedException();
        }

        $this->sessionExpiresAt = $now + $autologoutTime;
        $this->Session->set('session_expires_at', $this->sessionExpiresAt);
    }

    /**
     * Load a user object in our user field
     */
    private function loadUser(AuthenticatedUser | AnonymousUser $users): void
    {
        $this->Users = $users;
        $Notifications = new UserNotifications($this->Users);
        $this->notifsArr = $Notifications->readAll();
    }

    /**
     * Configure gettext domain
     * @psalm-suppress UnusedFunctionCall
     */
    private function initi18n(): void
    {
        $locale = $this->getLang() . '.utf8';
        $domain = 'messages';
        putenv("LC_ALL=$locale");
        setlocale(LC_ALL, $locale);
        bindtextdomain($domain, dirname(__DIR__, 2) . '/src/langs');
        bind_textdomain_codeset($domain, 'UTF-8');
        textdomain($domain);
    }
}
