<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use DateTimeImmutable;
use Elabftw\Elabftw\Permissions;
use Elabftw\Elabftw\Tools;
use Elabftw\Enums\Action;
use Elabftw\Enums\BasePermissions;
use Elabftw\Enums\BinaryValue;
use Elabftw\Enums\BodyContentType;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\FilterableColumn;
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Params\DisplayParams;
use Elabftw\Services\Filter;
use Elabftw\Traits\InsertTagsTrait;
use PDO;
use Symfony\Component\HttpFoundation\Request;
use Override;

use function _;
use function array_key_exists;
use function array_map;
use function is_string;
use function is_array;
use function trim;
use function implode;
use function preg_match;
use function json_decode;

/**
 * All about the inventory: a type of its own, a twin of the resources (see migration 110)
 */
final class Inventory extends AbstractConcreteEntity
{
    use InsertTagsTrait;

    protected const string FORCE_TEMPLATE_KEY = 'force_res_tpl';

    public EntityType $entityType = EntityType::Inventory;

    /** the entry that is made is a planned one: private, kept out of the lists, without a number */
    public bool $asPlanned = false;

    /** the copy made by duplicate() goes into the Database at once (registered, with a number), not into My entries */
    public bool $duplicateRegistered = false;

    /** the folder of the lab Database that has a subfolder for each module */
    public const string LAB_FOLDER = 'Database items';

    /** the folder (of the database) the copy made by duplicate() goes in */
    public ?int $duplicateFolderId = null;

    /** the entry that is made is not registered (an intermediate): in the Database like the others, but without a number until it is registered */
    public bool $asUnregistered = false;

    /** the entry that is made has the number of its owner (my id): null when it depends on being registered in the lab */
    public ?bool $withPersonal = null;

    #[Override]
    public function create(
        ?string $title = null,
        ?string $body = null,
        ?DateTimeImmutable $date = null,
        BasePermissions $canreadBase = BasePermissions::Team,
        BasePermissions $canwriteBase = BasePermissions::User,
        string $canread = self::EMPTY_CAN_JSON,
        string $canwrite = self::EMPTY_CAN_JSON,
        bool $canreadIsImmutable = false,
        bool $canwriteIsImmutable = false,
        array $tags = array(),
        ?int $category = null,
        ?int $status = null,
        ?int $customId = null,
        ?string $metadata = null,
        BinaryValue $hideMainText = BinaryValue::False,
        int $rating = 0,
        BodyContentType $contentType = BodyContentType::Html,
        ?EntityType $createdFromType = null,
        ?int $createdFromId = null,
        // specific to the resources, unused by the inventory but part of the shared signature
        string $canbook = self::EMPTY_CAN_JSON,
        BasePermissions $canbookBase = BasePermissions::Team,
        BinaryValue $isBookable = BinaryValue::False,
    ): int {
        $title = Filter::title($title ?? _('Untitled'));
        // the entries of the database are visible to everyone with an account and editable by their owner and the admins,
        // whatever the defaults of the user: only an admin can change that
        // a planned entry, and an entry that is not registered, are private to their owner until they are marked ready or registered
        $canreadBase = ($this->asPlanned || $this->asUnregistered) ? BasePermissions::UserOnly : BasePermissions::Organization;
        $canwriteBase = ($this->asPlanned || $this->asUnregistered) ? BasePermissions::UserOnly : BasePermissions::User;
        $canread = self::EMPTY_CAN_JSON;
        $canwrite = self::EMPTY_CAN_JSON;
        $canreadIsImmutable = true;
        $canwriteIsImmutable = true;
        // an entry of a category starts with the fields of that category
        if ($metadata === null && $category !== null) {
            $req = $this->Db->prepare('SELECT fields FROM inventory_categories WHERE id = :id');
            $req->bindParam(':id', $category, PDO::PARAM_INT);
            $this->Db->execute($req);
            $fields = $req->fetchColumn();
            $metadata = is_string($fields) && $fields !== '' ? $fields : null;
        }
        $date ??= new DateTimeImmutable();
        $body = Filter::body($body);
        if (empty($body)) {
            $body = null;
        }
        // each type of entry (plasmids, primers, ...) counts on its own: the next number of the module; a planned entry has none
        $customId ??= ($this->asPlanned || $this->asUnregistered) ? null : $this->nextNumber($category);

        $sql = 'INSERT INTO inventory(team, title, date, status, body, userid, category, elabid, canread_base, canwrite_base, canbook_base, canread, canwrite, canread_is_immutable, canwrite_is_immutable, canbook, metadata, custom_id, personal_id, content_type, rating, hide_main_text, created_from_type, created_from_id, is_bookable, is_planned)
            VALUES(:team, :title, :date, :status, :body, :userid, :category, :elabid, :canread_base, :canwrite_base, :canbook_base, :canread, :canwrite, :canread_is_immutable, :canwrite_is_immutable, :canbook, :metadata, :custom_id, :personal_id, :content_type, :rating, :hide_main_text, :created_from_type, :created_from_id, :is_bookable, :is_planned)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':title', $title);
        $req->bindValue(':date', $date->format('Y-m-d'));
        $req->bindParam(':status', $status);
        $req->bindParam(':body', $body);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindParam(':category', $category, PDO::PARAM_INT);
        $req->bindValue(':elabid', Tools::generateElabid());
        $req->bindValue(':canread_base', $canreadBase->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite_base', $canwriteBase->value, PDO::PARAM_INT);
        $req->bindValue(':canbook_base', $canbookBase->value, PDO::PARAM_INT);
        $req->bindParam(':canread', $canread);
        $req->bindParam(':canwrite', $canwrite);
        $req->bindParam(':canread_is_immutable', $canreadIsImmutable, PDO::PARAM_INT);
        $req->bindParam(':canwrite_is_immutable', $canwriteIsImmutable, PDO::PARAM_INT);
        $req->bindParam(':canbook', $canbook);
        $req->bindParam(':metadata', $metadata);
        $req->bindParam(':custom_id', $customId, PDO::PARAM_INT);
        // an entry registered in the lab at once has the number of its owner too; the others get it when they are registered
        $personalId = ($this->withPersonal ?? $customId !== null) ? $this->nextPersonalNumber((int) $this->Users->userData['userid'], $category) : null;
        $req->bindParam(':personal_id', $personalId, PDO::PARAM_INT);
        $req->bindValue(':content_type', $contentType->value, PDO::PARAM_INT);
        $req->bindParam(':rating', $rating, PDO::PARAM_INT);
        $req->bindValue(':hide_main_text', $hideMainText->value, PDO::PARAM_INT);
        $req->bindValue(':is_bookable', $isBookable->value, PDO::PARAM_INT);
        $req->bindValue(':is_planned', $this->asPlanned ? 1 : 0, PDO::PARAM_INT);
        $this->Db->bindNullableInt($req, ':created_from_type', $createdFromType?->toInt());
        $this->Db->bindNullableInt($req, ':created_from_id', $createdFromId);
        $this->Db->execute($req);
        $newId = $this->Db->lastInsertId();

        // an entry that is in the lab Database from the start is filed with the others of its module
        if ($customId !== null && $category !== null) {
            $this->fileInLabFolder($newId, $category);
        }
        $this->insertTags($tags, $newId);
        $this->addCreationToChangelog($newId, $createdFromType, $createdFromId);

        return $newId;
    }

    /**
     * The next number of a module: one more than the highest of its entries (the first is 1). Each module counts on its own, so
     * there can be a plasmid 123 and a primer 123.
     */
    private function nextNumber(?int $category): ?int
    {
        if ($category === null) {
            return null;
        }
        return $this->getCurrentHighestCustomId($category) + 1;
    }

    /**
     * An entry of the lab Database stays in the folder of its module: only the entries that are not registered (My entries) can be
     * moved to another folder.
     */
    #[Override]
    public function patch(Action $action, array $params): array
    {
        if ($action === Action::Update && array_key_exists('folder_id', $params) && $this->id !== null) {
            $req = $this->Db->prepare('SELECT custom_id, is_planned, folder_id FROM inventory WHERE id = :id');
            $req->bindParam(':id', $this->id, PDO::PARAM_INT);
            $this->Db->execute($req);
            $row = $req->fetch();
            $wanted = (string) $params['folder_id'] === '' ? 0 : (int) $params['folder_id'];
            if (is_array($row) && $row['custom_id'] !== null && (int) $row['is_planned'] === 0 && $wanted !== (int) ($row['folder_id'] ?? 0)) {
                throw new ImproperActionException(_('An entry of the Database stays in the folder of its module.'));
            }
            // and the only way into the folders of the Database is to add the entry to the Database
            if ($wanted > 0 && $this->isDatabaseFolder($wanted)) {
                throw new ImproperActionException(_('An entry gets into the folders of the Database only when it is added to the Database.'));
            }
        }
        return parent::patch($action, $params);
    }

    /** whether a folder is "Database items" or one of its subfolders */
    private function isDatabaseFolder(int $folderId): bool
    {
        $req = $this->Db->prepare("SELECT COUNT(*) FROM experiments_folders AS f LEFT JOIN experiments_folders AS p ON p.id = f.parent_id WHERE f.id = :id AND f.scope = 'inventory' AND ((f.parent_id IS NULL AND f.name = :root) OR (p.parent_id IS NULL AND p.name = :root2))");
        $req->bindParam(':id', $folderId, PDO::PARAM_INT);
        $root = self::LAB_FOLDER;
        $req->bindParam(':root', $root);
        $req->bindParam(':root2', $root);
        $this->Db->execute($req);
        return (int) $req->fetchColumn() > 0;
    }

    /**
     * An entry of the lab Database is filed in the folder "Database items", in the subfolder of its module (the folders are made
     * when they are not there yet)
     */
    private function fileInLabFolder(int $entryId, int $category): void
    {
        $req = $this->Db->prepare('SELECT title FROM inventory_categories WHERE id = :id');
        $req->bindValue(':id', $category, PDO::PARAM_INT);
        $this->Db->execute($req);
        $title = trim(str_replace(' > ', ' ', (string) $req->fetchColumn()));
        if ($title === '') {
            return;
        }
        $Folders = new ExperimentsFolders($this->Users, null, 'inventory');
        $Folders->assignInventory($entryId, $Folders->getIdFromPath(self::LAB_FOLDER . ' > ' . $title));
    }

    /**
     * The next number of an owner in a module: one more than the highest of their entries there (the first is 1). It is theirs
     * alone, whatever the number of the lab is.
     */
    private function nextPersonalNumber(int $userid, ?int $category): ?int
    {
        if ($category === null) {
            return null;
        }
        $req = $this->Db->prepare('SELECT COALESCE(MAX(personal_id), 0) FROM inventory WHERE userid = :userid AND category = :category');
        $req->bindValue(':userid', $userid, PDO::PARAM_INT);
        $req->bindValue(':category', $category, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $req->fetchColumn() + 1;
    }

    /** the statuses of what is not in the Database yet, with their colours */
    public const array PLANNED_STATUSES = array('Planned' => 'b0b7c3', 'Ordered' => 'f0a202', 'Being made' => '5b8def');

    /**
     * The id of a status of the planned entries in the team, made when it is not there yet
     */
    public function plannedStatusId(string $title): int
    {
        if (!isset(self::PLANNED_STATUSES[$title])) {
            throw new ImproperActionException(_('Unknown status.'));
        }
        $req = $this->Db->prepare('SELECT id FROM inventory_status WHERE team = :team AND title = :title AND state = 1 LIMIT 1');
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $this->Db->execute($req);
        $found = $req->fetchColumn();
        if ($found !== false) {
            return (int) $found;
        }
        $req = $this->Db->prepare('INSERT INTO inventory_status (team, title, color, is_private, ordering, state) VALUES (:team, :title, :color, 0, :ordering, 1)');
        $req->bindValue(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':color', self::PLANNED_STATUSES[$title]);
        $req->bindValue(':ordering', array_search($title, array_keys(self::PLANNED_STATUSES), true) + 1, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $this->Db->lastInsertId();
    }

    /**
     * An entry without a number is registered: it must have what its module requires (the required fields, and for the plasmids
     * a sequence), then it gets the next number of its module. A number is never taken back or given to another entry.
     *
     * @return int the number it got
     */
    public function register(): int
    {
        $this->canOrExplode(AccessType::Write);
        if ((int) ($this->entityData['is_planned'] ?? 0) === 1) {
            throw new ImproperActionException(_('This entry is only planned: move it to the Database first.'));
        }
        if ($this->entityData['custom_id'] !== null) {
            throw new ImproperActionException(_('This entry is registered already.'));
        }
        $category = $this->entityData['category'] ?? null;
        if ($category === null) {
            throw new ImproperActionException(_('A module is needed to give it a number: choose one first.'));
        }
        $missing = array();
        $metadata = json_decode((string) ($this->entityData['metadata'] ?? ''), true);
        foreach (is_array($metadata) ? ($metadata['extra_fields'] ?? array()) : array() as $name => $field) {
            if (is_array($field) && !empty($field['required']) && trim((string) ($field['value'] ?? '')) === '') {
                $missing[] = (string) $name;
            }
        }
        // the module says whether a sequence file is needed to register (a plasmid has one, a sample does not)
        $settingsReq = $this->Db->prepare('SELECT settings FROM inventory_categories WHERE id = :id');
        $settingsReq->bindValue(':id', (int) $category, PDO::PARAM_INT);
        $this->Db->execute($settingsReq);
        $settings = json_decode((string) $settingsReq->fetchColumn(), true);
        if (is_array($settings) && !empty($settings['requires_sequence_file'])) {
            $likes = implode(' OR ', array_map(static fn(string $ext): string => "LOWER(real_name) LIKE '%." . $ext . "'", array('gb', 'gbk', 'gbff', 'genbank', 'fasta', 'fa', 'fna', 'dna')));
            $files = $this->Db->prepare("SELECT COUNT(*) FROM uploads WHERE item_id = :id AND type = 'inventory' AND state = 1 AND (" . $likes . ')');
            $files->bindValue(':id', $this->id, PDO::PARAM_INT);
            $this->Db->execute($files);
            if ((int) $files->fetchColumn() === 0) {
                $missing[] = _('a sequence file');
            }
        }
        if ($missing !== array()) {
            throw new ImproperActionException(_('It cannot be registered yet, it needs: ') . implode(', ', $missing) . '.');
        }
        $number = $this->nextNumber((int) $category);
        $req = $this->Db->prepare('UPDATE inventory SET custom_id = :number, personal_id = COALESCE(personal_id, :personal), canread_base = :canread, canwrite_base = :canwrite WHERE id = :id AND custom_id IS NULL AND is_planned = 0');
        $req->bindValue(':number', $number, PDO::PARAM_INT);
        $req->bindValue(':personal', $this->nextPersonalNumber((int) $this->entityData['userid'], (int) $category), PDO::PARAM_INT);
        $req->bindValue(':canread', BasePermissions::Organization->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite', BasePermissions::User->value, PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $this->fileInLabFolder($this->id, (int) $category);
        return (int) $number;
    }

    /**
     * An entry registers for its owner only: it gets the next number of its owner in the module, and stays private to them
     *
     * @return int the number it got
     */
    public function registerPersonal(): int
    {
        $this->canOrExplode(AccessType::Write);
        $category = $this->entityData['category'] ?? null;
        if ($category === null) {
            throw new ImproperActionException(_('A module is needed to give it a number: choose one first.'));
        }
        if ($this->entityData['personal_id'] !== null) {
            throw new ImproperActionException(_('This entry has a number of its owner already.'));
        }
        $number = $this->nextPersonalNumber((int) $this->entityData['userid'], (int) $category);
        $req = $this->Db->prepare('UPDATE inventory SET personal_id = :number WHERE id = :id AND personal_id IS NULL');
        $req->bindValue(':number', $number, PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $number;
    }

    /**
     * The status of a planned entry changes (Planned, Ordered, Being made)
     */
    public function setPlannedStatus(string $title): void
    {
        $this->canOrExplode(AccessType::Write);
        if ((int) ($this->entityData['is_planned'] ?? 0) !== 1) {
            throw new ImproperActionException(_('This entry is not a planned one.'));
        }
        $req = $this->Db->prepare('UPDATE inventory SET status = :status WHERE id = :id AND is_planned = 1');
        $req->bindValue(':status', $this->plannedStatusId($title), PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    /**
     * A planned entry moves into the Database: it keeps the number it had before if it was in the Database already, else it gets
     * the next number of its module, and it is visible to everyone with an account like the other entries. Only its owner (and
     * the admins) can do it.
     *
     * @return int the number it has
     */
    public function markReady(): int
    {
        $this->canOrExplode(AccessType::Write);
        if ((int) ($this->entityData['is_planned'] ?? 0) !== 1) {
            throw new ImproperActionException(_('This entry is not a planned one.'));
        }
        $category = $this->entityData['category'] ?? null;
        if ($category === null) {
            throw new ImproperActionException(_('A module is needed to give it a number: choose one first.'));
        }
        // an entry that was in the Database before keeps its number: nobody else could have taken it, the numbers of the planned
        // entries count for the next number of the module
        $number = $this->entityData['custom_id'] !== null ? (int) $this->entityData['custom_id'] : $this->nextNumber((int) $category);
        $req = $this->Db->prepare('UPDATE inventory SET is_planned = 0, custom_id = :number, personal_id = COALESCE(personal_id, :personal), status = NULL, canread_base = :canread, canwrite_base = :canwrite WHERE id = :id AND is_planned = 1');
        $req->bindValue(':number', $number, PDO::PARAM_INT);
        $req->bindValue(':personal', $this->nextPersonalNumber((int) $this->entityData['userid'], (int) $category), PDO::PARAM_INT);
        $req->bindValue(':canread', BasePermissions::Organization->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite', BasePermissions::User->value, PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $this->fileInLabFolder($this->id, (int) $category);
        return (int) $number;
    }

    /**
     * An entry of the Database goes back to the planned ones: private, out of the lists. It keeps its number, so it has the same
     * one when it moves into the Database again.
     */
    public function markPlanned(): void
    {
        $this->canOrExplode(AccessType::Write);
        if ((int) ($this->entityData['is_planned'] ?? 0) === 1) {
            throw new ImproperActionException(_('This entry is planned already.'));
        }
        $req = $this->Db->prepare('UPDATE inventory SET is_planned = 1, status = :status, canread_base = :canread, canwrite_base = :canwrite WHERE id = :id AND is_planned = 0');
        $req->bindValue(':status', $this->plannedStatusId('Planned'), PDO::PARAM_INT);
        $req->bindValue(':canread', BasePermissions::UserOnly->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite', BasePermissions::UserOnly->value, PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    /**
     * The lists of the database leave out the planned entries and the ones that are not registered, except in the list of the owner (planned=1), which has all the entries of the owner
     */
    #[Override]
    public function readShow(QueryParamsInterface $displayParams, bool $extended = false, string $can = 'canread'): array
    {
        $before = $this->filterSql;
        // an entry without a number (and with a module) is not registered: it is in the list of its owner only (planned=1), the
        // lists of the Database show the registered entries
        if ($displayParams->getQuery()->getBoolean('planned')) {
            $this->filterSql .= ' AND entity.userid = ' . (int) $this->Users->userData['userid'] . ' ';
            // which of them: in the lab Database, registered for the owner only, or without any number
            $filter = $displayParams->getQuery()->getString('idstate');
            if ($filter === 'lab') {
                $this->filterSql .= ' AND entity.is_planned = 0 AND entity.custom_id IS NOT NULL ';
            } elseif ($filter === 'notlab') {
                $this->filterSql .= ' AND (entity.is_planned = 1 OR entity.custom_id IS NULL) ';
            } elseif ($filter === 'personal') {
                $this->filterSql .= ' AND entity.custom_id IS NULL AND entity.personal_id IS NOT NULL ';
            } elseif ($filter === 'none') {
                $this->filterSql .= ' AND entity.custom_id IS NULL AND entity.personal_id IS NULL ';
            }
        } else {
            $this->filterSql .= ' AND entity.is_planned = 0 AND (entity.custom_id IS NOT NULL OR entity.category IS NULL) ';
        }
        try {
            return parent::readShow($displayParams, $extended, $can);
        } finally {
            $this->filterSql = $before;
        }
    }

    /**
     * Get all items with is_bookable that we can read
     */
    public function readBookable(): array
    {
        $Request = Request::createFromGlobals();
        $DisplayParams = new DisplayParams($this->Users, EntityType::Inventory, $Request->query);
        // we only want the bookable type of items
        $DisplayParams->appendFilterSql(FilterableColumn::Bookable, 1);
        // filter on the canbook or canread depending on query param
        if ($Request->query->has('canbook')) {
            return $this->readShow($DisplayParams, true, 'canbook');
        }
        return $this->readShow($DisplayParams, true);
    }

    public function canBook(): bool
    {
        $Permissions = new Permissions($this->Users, $this->entityData);
        return $Permissions->forEntity()->book;
    }

    public function canBookInPast(): bool
    {
        return $this->Users->isAdmin || (bool) $this->entityData['book_users_can_in_past'];
    }

    #[Override]
    public function duplicate(bool $copyFiles = false, bool $linkToOriginal = false): int
    {
        $this->canOrExplode(AccessType::Read);

        // a copy is a local copy by default: not registered, in My entries, private to the user, without a number, until it is registered;
        // a copy to the Database is registered at once and gets the next number of its module
        $this->asUnregistered = !$this->duplicateRegistered;
        $newId = $this->copyEntityFrom(
            sourceEntity: $this,
            title: $this->entityData['title'] . ' I',
            copyFiles: $copyFiles,
            overrideCreateParams: array(
                'canbook' => $this->entityData['canbook'],
                'canbookBase' => BasePermissions::from($this->entityData['canbook_base']),
                'isBookable' => BinaryValue::from($this->entityData['is_bookable']),
            ),
        );

        $this->asUnregistered = false;
        if ($this->duplicateFolderId !== null) {
            new ExperimentsFolders($this->Users, null, 'inventory')->assignInventory($newId, $this->duplicateFolderId);
        }
        // the copy is a daughter of the original: the original is its parent
        $req = $this->Db->prepare('INSERT IGNORE INTO inventory2inventory (item_id, link_id) VALUES (:child, :parent)');
        $req->bindValue(':child', $newId, PDO::PARAM_INT);
        $req->bindValue(':parent', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $newId;
    }

    #[Override]
    // get users who booked current item in the 4 surrounding months
    protected function getSurroundingBookers(): array
    {
        // save a sql query if the resource is not bookable
        if (!$this->entityData['is_bookable']) {
            return array();
        }
        // Note: here we select past and future bookers but skip the ones that are archived in all teams
        $sql = 'SELECT DISTINCT
                u.email,
                CONCAT(u.firstname, " ", u.lastname) AS fullname
            FROM team_events tev
            JOIN users u
              ON u.userid = tev.userid
            LEFT JOIN (
                SELECT users_id, MIN(is_archived) AS all_archived
                FROM users2teams
                GROUP BY users_id
            ) ut
              ON ut.users_id = u.userid
            WHERE tev.item = :itemid
              AND tev.start BETWEEN DATE_SUB(NOW(), INTERVAL 4 MONTH)
                              AND DATE_ADD(NOW(), INTERVAL 4 MONTH)
              AND u.validated = 1
              AND COALESCE(ut.all_archived, 0) = 0';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':itemid', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    #[Override]
    protected function getCreatePermissionKey(): string
    {
        return 'users_canwrite_resources';
    }
}
