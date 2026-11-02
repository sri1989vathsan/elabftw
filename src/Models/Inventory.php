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
use function is_string;

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
        // a planned entry is private to its owner until it is marked ready
        $canreadBase = $this->asPlanned ? BasePermissions::UserOnly : BasePermissions::Organization;
        $canwriteBase = $this->asPlanned ? BasePermissions::UserOnly : BasePermissions::User;
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
        $customId ??= $this->asPlanned ? null : $this->nextNumber($category);

        $sql = 'INSERT INTO inventory(team, title, date, status, body, userid, category, elabid, canread_base, canwrite_base, canbook_base, canread, canwrite, canread_is_immutable, canwrite_is_immutable, canbook, metadata, custom_id, content_type, rating, hide_main_text, created_from_type, created_from_id, is_bookable, is_planned)
            VALUES(:team, :title, :date, :status, :body, :userid, :category, :elabid, :canread_base, :canwrite_base, :canbook_base, :canread, :canwrite, :canread_is_immutable, :canwrite_is_immutable, :canbook, :metadata, :custom_id, :content_type, :rating, :hide_main_text, :created_from_type, :created_from_id, :is_bookable, :is_planned)';
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
        $req->bindValue(':content_type', $contentType->value, PDO::PARAM_INT);
        $req->bindParam(':rating', $rating, PDO::PARAM_INT);
        $req->bindValue(':hide_main_text', $hideMainText->value, PDO::PARAM_INT);
        $req->bindValue(':is_bookable', $isBookable->value, PDO::PARAM_INT);
        $req->bindValue(':is_planned', $this->asPlanned ? 1 : 0, PDO::PARAM_INT);
        $this->Db->bindNullableInt($req, ':created_from_type', $createdFromType?->toInt());
        $this->Db->bindNullableInt($req, ':created_from_id', $createdFromId);
        $this->Db->execute($req);
        $newId = $this->Db->lastInsertId();

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
     * A planned entry becomes a real one: it gets the next number of its module and is visible to everyone with an account
     * like the other entries of the database. Only its owner (and the admins) can do it.
     *
     * @return int the number it got
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
        $number = $this->nextNumber((int) $category);
        $req = $this->Db->prepare('UPDATE inventory SET is_planned = 0, custom_id = :number, canread_base = :canread, canwrite_base = :canwrite WHERE id = :id AND is_planned = 1');
        $req->bindValue(':number', $number, PDO::PARAM_INT);
        $req->bindValue(':canread', BasePermissions::Organization->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite', BasePermissions::User->value, PDO::PARAM_INT);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $number;
    }

    /**
     * The lists of the database leave out the planned entries, except the ones of the owner asking for them (planned=1)
     */
    #[Override]
    public function readShow(QueryParamsInterface $displayParams, bool $extended = false, string $can = 'canread'): array
    {
        $before = $this->filterSql;
        if ($displayParams->getQuery()->getBoolean('planned')) {
            $this->filterSql .= ' AND entity.is_planned = 1 AND entity.userid = ' . (int) $this->Users->userData['userid'] . ' ';
        } else {
            $this->filterSql .= ' AND entity.is_planned = 0 ';
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
