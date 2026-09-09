<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use DateTimeImmutable;
use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Override;
use PDO;

use function array_fill;
use function array_key_exists;
use function ctype_digit;
use function array_map;
use function array_unique;
use function array_values;
use function count;
use function implode;
use function in_array;
use function is_array;
use function json_decode;
use function mb_strlen;
use function preg_replace;
use function preg_split;
use function trim;

use const JSON_THROW_ON_ERROR;

/**
 * A team-scoped "please order this" board, replacing an external Trello
 * board. Unlike the native procurement_requests table, an order does not
 * require an existing procurable resource -- linked items are optional,
 * and an order can link any number of Resources database items, not just
 * ones marked procurable.
 */
final class Orders extends AbstractRest
{
    use SetIdTrait;

    private const array STATUSES = array('requested', 'ordered', 'received', 'cancelled', 'reference');

    public function __construct(private Users $Users, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/orders/';
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $title = $this->getTitle($reqBody['title'] ?? '');
        $notes = $this->getNotes($reqBody['notes'] ?? null);
        $itemIds = $this->getItemIds($reqBody['item_ids'] ?? null);
        // status is optional -- a plain order starts 'requested' (the column
        // default) same as always; the only other choice at creation time is
        // marking it 'reference' up front, since that's known at the moment
        // you're logging catalog info rather than placing a real request,
        // not something you'd normally discover partway through the order's
        // ordered/received/cancelled lifecycle.
        $status = $reqBody['status'] ?? null;
        if ($status !== null && !in_array($status, self::STATUSES, true)) {
            throw new ImproperActionException('Invalid order status.');
        }
        // a reference is a shared team lookup, not a request working through
        // a lifecycle -- pin it immediately so it's not sitting invisible
        // beside real, gone-once-fulfilled requests unless someone digs it
        // out of the Reference tab. See also updateStatus() below, which
        // keeps this true if a plain order is later marked reference.
        $pinned = $status === 'reference' ? 1 : 0;
        $sql = "INSERT INTO custom_orders (team, userid, title, notes, status, pinned)
            VALUES (:team, :userid, :title, :notes, COALESCE(:status, 'requested'), :pinned)";
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':status', $status, $status === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindValue(':pinned', $pinned, PDO::PARAM_INT);
        $this->Db->execute($req);
        $orderId = (int) $this->Db->lastInsertId();

        if (!empty($itemIds)) {
            $this->setId($orderId);
            $this->replaceItems($itemIds);
        }

        return $orderId;
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $queryParams ??= $this->getQueryParams();
        $query = $queryParams->getQuery();

        $conditions = array('o.team = :team');
        $bind = array(':team' => array($this->Users->team, PDO::PARAM_INT));

        $status = $query->getString('status');
        if ($status === 'archived') {
            $conditions[] = 'o.archived = 1';
        } elseif ($status === 'all') {
            $conditions[] = 'o.archived = 0';
        } elseif (in_array($status, self::STATUSES, true)) {
            $conditions[] = 'o.archived = 0';
            // pinned orders stay visible on every status tab, not just the
            // one matching their own status -- that's the point of pinning.
            // Reference orders are the one exception: they live only on
            // their own Reference tab (and All), never bleeding into the
            // others just because they happen to be pinned too.
            $conditions[] = "(o.status = :status OR (o.pinned = 1 AND o.status != 'reference'))";
            $bind[':status'] = array($status, PDO::PARAM_STR);
        }

        $dateFrom = $this->parseFilterDate($query->getString('date_from'));
        if ($dateFrom !== null) {
            $conditions[] = 'o.created_at >= :date_from';
            $bind[':date_from'] = array($dateFrom . ' 00:00:00', PDO::PARAM_STR);
        }
        $dateTo = $this->parseFilterDate($query->getString('date_to'));
        if ($dateTo !== null) {
            $conditions[] = 'o.created_at <= :date_to';
            $bind[':date_to'] = array($dateTo . ' 23:59:59', PDO::PARAM_STR);
        }

        // everyone can filter down to their own orders ("Mine" tab); picking
        // someone else's id is an admin-only privilege, enforced here and
        // not just hidden in the UI, so a non-admin can't just add the param.
        // A reference order is a shared team reference, not a personal
        // request, so it stays visible even while "Mine" is selected.
        $userid = $query->getInt('userid');
        if ($userid > 0 && ($userid === $this->Users->userid || $this->Users->isAdmin)) {
            $conditions[] = "(o.userid = :userid OR o.status = 'reference')";
            $bind[':userid'] = array($userid, PDO::PARAM_INT);
        }

        // server-side so a match on page 2 is found while looking at page 1
        // (client-side search only ever covered the currently loaded page).
        // Each place is its own EXISTS/MATCH/LIKE rather than one
        // pre-aggregated text blob, so a non-matching order never has to
        // compute any of them; PDF-extracted text (potentially large) is
        // opt-in via search_pdf, since scanning it for every order is the
        // expensive part.
        // title/notes, comment bodies and extracted PDF text are matched via
        // FULLTEXT (see migration 045) rather than LIKE '%term%', since none
        // of those can use an ordinary index for a substring scan. Author
        // name and item title stay LIKE -- short, low-cardinality fields
        // where a table scan is cheap and FULLTEXT's word-tokenization would
        // be a worse fit (e.g. a name typed as a substring of itself).
        $search = trim($query->getString('search'));
        if ($search !== '') {
            $fulltext = self::toFulltextQuery($search);
            $like = '%' . $search . '%';
            $searchConditions = array(
                'CONCAT(author.firstname, " ", author.lastname) LIKE :search_author',
                'EXISTS (SELECT 1 FROM custom_order_items AS s_oi
                    INNER JOIN items AS s_item ON s_item.id = s_oi.item_id
                    WHERE s_oi.order_id = o.id AND s_item.title LIKE :search_item)',
                'o.procurement_id LIKE :search_procurement_id',
                'o.order_number LIKE :search_order_number',
            );
            $bind[':search_author'] = array($like, PDO::PARAM_STR);
            $bind[':search_item'] = array($like, PDO::PARAM_STR);
            $bind[':search_procurement_id'] = array($like, PDO::PARAM_STR);
            $bind[':search_order_number'] = array($like, PDO::PARAM_STR);
            // a bare number searches the order's own id too -- nothing else
            // above matches it (title/notes FULLTEXT ignores short tokens,
            // and it isn't the procurement id/order number)
            if (ctype_digit($search)) {
                $searchConditions[] = 'o.id = :search_id';
                $bind[':search_id'] = array((int) $search, PDO::PARAM_INT);
            }
            if ($fulltext !== null) {
                $searchConditions[] = 'MATCH(o.title, o.notes) AGAINST(:search_fulltext IN BOOLEAN MODE)';
                $searchConditions[] = 'EXISTS (SELECT 1 FROM custom_order_comments AS s_comment
                    WHERE s_comment.order_id = o.id
                    AND MATCH(s_comment.body) AGAINST(:search_fulltext IN BOOLEAN MODE))';
                $bind[':search_fulltext'] = array($fulltext, PDO::PARAM_STR);
                if ($query->getBoolean('search_pdf')) {
                    $searchConditions[] = 'EXISTS (SELECT 1 FROM custom_order_uploads AS s_upload
                        WHERE s_upload.order_id = o.id
                        AND (s_upload.real_name LIKE :search_upload
                            OR MATCH(s_upload.extracted_text) AGAINST(:search_fulltext IN BOOLEAN MODE)))';
                    $bind[':search_upload'] = array($like, PDO::PARAM_STR);
                }
            } elseif ($query->getBoolean('search_pdf')) {
                // $search was made entirely of characters stripped by
                // toFulltextQuery() (e.g. only punctuation) -- nothing left
                // to MATCH against, but the filename can still be searched
                $searchConditions[] = 'EXISTS (SELECT 1 FROM custom_order_uploads AS s_upload
                    WHERE s_upload.order_id = o.id AND s_upload.real_name LIKE :search_upload)';
                $bind[':search_upload'] = array($like, PDO::PARAM_STR);
            }
            $conditions[] = '(' . implode(' OR ', $searchConditions) . ')';
        }

        $limit = $query->getInt('limit') ?: 0;
        $offset = max(0, $query->getInt('offset'));

        if ($limit === 0) {
            $sql = self::selectSql() . '
                WHERE ' . implode(' AND ', $conditions) . '
                ORDER BY o.pinned DESC, o.created_at DESC';

            return array_map($this->hydrate(...), $this->fetchAllBound($sql, $bind));
        }

        // Pinned orders get their own always-visible section on the
        // frontend rather than counting against the page size -- fetch
        // every matching pinned row regardless of offset/limit, so a
        // handful of pins can never squeeze unpinned orders off the
        // requested page (e.g. 4 pinned + a 10-per-page setting used to mean
        // only 6 unpinned orders were shown; now it's the full 10).
        // Pagination itself then only walks the unpinned rows.
        $pinnedSql = self::selectSql() . '
            WHERE ' . implode(' AND ', $conditions) . '
            AND o.pinned = 1
            ORDER BY o.created_at DESC';
        $pinnedRows = $this->fetchAllBound($pinnedSql, $bind);

        // ask for one extra row so the frontend can tell whether there's a
        // next page without a separate COUNT query
        $unpinnedSql = self::selectSql() . '
            WHERE ' . implode(' AND ', $conditions) . "
            AND o.pinned = 0
            ORDER BY o.created_at DESC LIMIT " . ($limit + 1) . " OFFSET {$offset}";
        $unpinnedRows = $this->fetchAllBound($unpinnedSql, $bind);

        return array_map($this->hydrate(...), array(...$pinnedRows, ...$unpinnedRows));
    }

    /** @param array<string, array{0: mixed, 1: int}> $bind */
    private function fetchAllBound(string $sql, array $bind): array
    {
        $req = $this->Db->prepare($sql);
        foreach ($bind as $key => $valueAndType) {
            [$value, $type] = $valueAndType;
            $req->bindValue($key, $value, $type);
        }
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    /**
     * Validate a date_from/date_to filter value (Y-m-d), or return null for
     * an absent/blank one. An unparseable value is a client bug (the input
     * is a native date picker), so it's rejected rather than silently
     * ignored or passed through to a DATETIME comparison.
     */
    private function parseFilterDate(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if (DateTimeImmutable::createFromFormat('Y-m-d', $value) === false) {
            throw new ImproperActionException('Invalid date filter.');
        }
        return $value;
    }

    /**
     * Turn a raw search string into a MySQL BOOLEAN MODE full-text query, or
     * null if nothing indexable survives. Boolean-mode operator characters
     * (+ - > < ( ) ~ * : " @ \) are stripped rather than honored -- passed
     * through, an unbalanced quote or stray operator from ordinary user
     * input would make MySQL reject the whole query as invalid full-text
     * syntax instead of just searching for it literally. A trailing '*' is
     * appended to each remaining word for prefix matching, the closest
     * full-text analog to the previous LIKE '%term%' substring behavior --
     * though unlike LIKE, a word shorter than innodb_ft_min_token_size
     * (server default: 3 characters) still won't match anything.
     */
    private static function toFulltextQuery(string $search): ?string
    {
        $sanitized = preg_replace('/[+\-><()~*:"@\\\\]+/', ' ', $search) ?? '';
        $words = preg_split('/\s+/', trim($sanitized), -1, PREG_SPLIT_NO_EMPTY);
        if ($words === array()) {
            return null;
        }
        return implode(' ', array_map(static fn(string $word): string => $word . '*', $words));
    }

    /**
     * The SELECT/FROM/JOIN shared by readAll() and readOne() -- only the
     * WHERE clause differs, so both get the same shape (items, comments,
     * uploads and extracted PDF text) without duplicating these subqueries.
     */
    private static function selectSql(): string
    {
        return 'SELECT o.id, o.title, o.notes, o.procurement_id, o.order_number, o.status, o.archived, o.pinned, o.created_at, o.userid,
                CONCAT(author.firstname, " ", author.lastname) AS author_fullname,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT("id", oi_item.id, "title", oi_item.title))
                    FROM custom_order_items AS oi
                    INNER JOIN items AS oi_item ON oi_item.id = oi.item_id
                    WHERE oi.order_id = o.id
                ), JSON_ARRAY()) AS items,
                COALESCE((
                    SELECT JSON_ARRAYAGG(JSON_OBJECT(
                        "id", upload.id,
                        "real_name", upload.real_name,
                        "long_name", upload.long_name,
                        "storage", upload.storage,
                        "filesize", upload.filesize,
                        "has_extracted_text", (upload.extracted_text IS NOT NULL),
                        "extraction_status", upload.extraction_status,
                        "created_at", upload.created_at,
                        "userid", upload.userid,
                        "author_fullname", (SELECT CONCAT(u2.firstname, " ", u2.lastname) FROM users AS u2 WHERE u2.userid = upload.userid)
                    ))
                    FROM custom_order_uploads AS upload
                    WHERE upload.order_id = o.id
                ), JSON_ARRAY()) AS uploads
            FROM custom_orders AS o
            LEFT JOIN users AS author ON author.userid = o.userid';
    }

    /** Cast the raw DB row types and decode the JSON-aggregated columns. */
    private function hydrate(array $order): array
    {
        $order['id'] = (int) $order['id'];
        $order['userid'] = (int) $order['userid'];
        $order['archived'] = (bool) $order['archived'];
        $order['pinned'] = (bool) $order['pinned'];
        $order['items'] = json_decode((string) $order['items'], true, 512, JSON_THROW_ON_ERROR);
        $uploads = json_decode((string) $order['uploads'], true, 512, JSON_THROW_ON_ERROR);
        foreach ($uploads as &$upload) {
            $upload['id'] = (int) $upload['id'];
            $upload['storage'] = (int) $upload['storage'];
            $upload['userid'] = (int) $upload['userid'];
            $upload['filesize'] = $upload['filesize'] !== null ? (int) $upload['filesize'] : null;
            $upload['has_extracted_text'] = (bool) $upload['has_extracted_text'];
        }
        unset($upload);
        $order['uploads'] = $uploads;

        return $order;
    }

    #[Override]
    public function readOne(): array
    {
        $sql = self::selectSql() . ' WHERE o.id = :id AND o.team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $order = $this->Db->fetch($req);

        return $this->hydrate($order);
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $order = $this->readOne();
        $isOwner = $order['userid'] === $this->Users->userid;
        if (array_key_exists('status', $params)) {
            $this->updateStatus((string) $params['status']);
        }
        if (array_key_exists('archived', $params)) {
            $this->updateArchived((bool) $params['archived']);
        }
        if (array_key_exists('pinned', $params)) {
            // a reference stays pinned -- see updateStatus()/postAction() --
            // so an explicit unpin is a no-op rather than an error while
            // this order is (or is becoming, in this same request) one
            $finalStatus = array_key_exists('status', $params) ? (string) $params['status'] : $order['status'];
            if ((bool) $params['pinned'] || $finalStatus !== 'reference') {
                $this->updatePinned((bool) $params['pinned']);
            }
        }
        if (array_key_exists('title', $params) || array_key_exists('notes', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this order.');
            }
            $this->updateContent(
                array_key_exists('title', $params) ? $this->getTitle($params['title']) : $order['title'],
                array_key_exists('notes', $params) ? $this->getNotes($params['notes']) : $order['notes'],
            );
        }
        if (array_key_exists('item_ids', $params)) {
            if (!$isOwner && !$this->Users->isAdmin) {
                throw new ImproperActionException('Only the author or a team admin can edit this order.');
            }
            $this->replaceItems($this->getItemIds($params['item_ids']));
        }
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $order = $this->readOne();
        if ($order['userid'] !== $this->Users->userid && !$this->Users->isAdmin) {
            throw new ImproperActionException('Only the author or a team admin can delete this order.');
        }
        $sql = 'DELETE FROM custom_orders WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);

        return $this->Db->execute($req);
    }

    private function updateStatus(string $status): void
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new ImproperActionException('Invalid order status.');
        }
        // same "a reference stays pinned" rule postAction() applies at
        // creation -- also enforced here so marking an existing order as
        // reference later has the same effect
        $sql = $status === 'reference'
            ? 'UPDATE custom_orders SET status = :status, pinned = 1 WHERE id = :id AND team = :team'
            : 'UPDATE custom_orders SET status = :status WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':status', $status);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateArchived(bool $archived): void
    {
        $sql = 'UPDATE custom_orders SET archived = :archived WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':archived', $archived, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updatePinned(bool $pinned): void
    {
        $sql = 'UPDATE custom_orders SET pinned = :pinned WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':pinned', $pinned, PDO::PARAM_INT);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function updateContent(string $title, ?string $notes): void
    {
        $sql = 'UPDATE custom_orders SET title = :title, notes = :notes WHERE id = :id AND team = :team';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':title', $title);
        $req->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    // full-replace: whatever set of item ids is passed becomes the order's
    // complete list of linked resources (same idea as the Share modal's
    // canread/canwrite editors -- it shows the current set, Save replaces it)
    private function replaceItems(array $itemIds): void
    {
        $delReq = $this->Db->prepare('DELETE FROM custom_order_items WHERE order_id = :order_id');
        $delReq->bindParam(':order_id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($delReq);

        if (empty($itemIds)) {
            return;
        }
        $insReq = $this->Db->prepare('INSERT INTO custom_order_items (order_id, item_id) VALUES (:order_id, :item_id)');
        foreach ($itemIds as $itemId) {
            $insReq->bindParam(':order_id', $this->id, PDO::PARAM_INT);
            $insReq->bindValue(':item_id', $itemId, PDO::PARAM_INT);
            $this->Db->execute($insReq);
        }
    }

    private function getTitle(mixed $value): string
    {
        $title = Filter::toPureString((string) $value);
        if ($title === '' || mb_strlen($title) > 255) {
            throw new ImproperActionException('A title is required and must be shorter than 255 characters.');
        }
        return $title;
    }

    private function getNotes(mixed $value): ?string
    {
        $trimmed = trim((string) $value);
        if ($value === null || $trimmed === '') {
            return null;
        }
        if (mb_strlen($trimmed) > 10000) {
            throw new ImproperActionException('Notes must be shorter than 10000 characters.');
        }
        // Filter::body() (not toPureString()) so a pasted link can render as
        // a link-preview badge, same as Todolist's notes/description
        return Filter::body($trimmed);
    }

    /** @return list<int> */
    private function getItemIds(mixed $value): array
    {
        if ($value === null) {
            return array();
        }
        if (!is_array($value)) {
            throw new ImproperActionException('Invalid resource list.');
        }
        $itemIds = array_values(array_unique(array_map(static function (mixed $v): int {
            $itemId = filter_var($v, FILTER_VALIDATE_INT);
            if ($itemId === false) {
                throw new ImproperActionException('Invalid resource.');
            }
            return $itemId;
        }, $value)));
        if (empty($itemIds)) {
            return array();
        }
        $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
        $sql = "SELECT id FROM items WHERE team = ? AND id IN ({$placeholders})";
        $req = $this->Db->prepare($sql);
        $req->execute(array($this->Users->team, ...$itemIds));
        $found = array_map(static fn(array $row): int => (int) $row['id'], $req->fetchAll());
        if (count($found) !== count($itemIds)) {
            throw new ImproperActionException('One or more resources could not be found.');
        }
        return $itemIds;
    }
}
