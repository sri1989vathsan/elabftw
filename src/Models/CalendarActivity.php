<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use DateInterval;
use DateTimeImmutable;
use Elabftw\Elabftw\CanSqlBuilder;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\State;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\CalendarActivityIndexer;
use Elabftw\Services\SlowOperationTimer;
use Override;
use PDO;

use function count;
use function sprintf;
use function array_values;

/**
 * Read owned experiment/resource activity for the account calendar.
 *
 * Dated headings are read from a fork-owned materialized index. This avoids
 * scanning and parsing every full entity body on every calendar request.
 */
final class CalendarActivity extends AbstractRest
{
    private const int MAX_RANGE_DAYS = 62;

    // Cap on entities (re)indexed inline per request. A team with a large never-indexed
    // backlog (e.g. right after this feature ships) gets its calendar filled in over a
    // few page views instead of one request doing the whole backlog. Run
    // `bin/console custom:calendar-backfill` to drain a backlog in one go instead.
    private const int MAX_INLINE_BACKFILL = 200;

    public function __construct(
        private Users $Users,
        private CalendarActivityIndexer $Indexer = new CalendarActivityIndexer(),
    ) {
        parent::__construct();
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/calendar_activity/';
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $query = $queryParams?->getQuery();
        $today = new DateTimeImmutable('today');
        $from = $this->parseDate($query?->getString('from') ?: $today->modify('first day of this month')->format('Y-m-d'));
        $to = $this->parseDate($query?->getString('to') ?: $from->add(new DateInterval('P41D'))->format('Y-m-d'));
        $days = (int) $from->diff($to)->format('%r%a');
        if ($days < 0 || $days > self::MAX_RANGE_DAYS) {
            throw new ImproperActionException(sprintf(
                'Calendar activity range must be between 0 and %d days.',
                self::MAX_RANGE_DAYS,
            ));
        }
        $teamScoped = $query?->getString('scope') === 'team';

        return array(
            'from' => $from->format('Y-m-d'),
            'to' => $to->format('Y-m-d'),
            'experiments' => $this->getEntities(EntityType::Experiments, $from, $to, $teamScoped),
            'items' => $this->getEntities(EntityType::Items, $from, $to, $teamScoped),
        );
    }

    private function getEntities(
        EntityType $entityType,
        DateTimeImmutable $from,
        DateTimeImmutable $to,
        bool $teamScoped,
    ): array {
        $Timer = SlowOperationTimer::start('calendar_activity', array(
            'entity_type' => $entityType->value,
            'team_scope' => $teamScoped,
        ));
        // This also performs a one-time backfill for existing installations and
        // incrementally refreshes only entities whose modified_at changed, bounded
        // so a large backlog can't turn this request into a long-running one.
        $this->Indexer->synchronizeTeam($entityType, $this->Users->team, self::MAX_INLINE_BACKFILL);

        $scopeSql = 'entity.team = :teamid AND entity.userid = :userid';
        if ($teamScoped) {
            // Team scope must still honor every entity's read permissions.
            $scopeSql = 'entity.team = :teamid'
                . (new CanSqlBuilder($this->Users, AccessType::Read))->getCanFilter();
        }

        $sql = sprintf(
            'SELECT entity.id, entity.title, entity.date,
                    activity.heading_index, activity.entry_date, activity.heading_level,
                    activity.heading_text, activity.parent_index, activity.anchor
                FROM %s AS entity
                LEFT JOIN custom_calendar_activity_entries AS activity
                    ON activity.entity_type = :entity_type
                    AND activity.entity_id = entity.id
                    AND activity.entry_date BETWEEN :from_date AND :to_date
                WHERE %s
                    AND entity.state IN (%d, %d)
                    AND (entity.date BETWEEN :from_date AND :to_date OR activity.entity_id IS NOT NULL)
                ORDER BY entity.date ASC, entity.title ASC, activity.heading_index ASC',
            $entityType->value,
            $scopeSql,
            State::Normal->value,
            State::Archived->value,
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':teamid', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':from_date', $from->format('Y-m-d'));
        $req->bindValue(':to_date', $to->format('Y-m-d'));
        $req->bindValue(':entity_type', $entityType->value);
        $this->Db->execute($req);

        $result = array();
        foreach ($req->fetchAll() as $entity) {
            $id = (int) $entity['id'];
            if (!isset($result[$id])) {
                $result[$id] = array(
                    'id' => (int) $entity['id'],
                    'title' => (string) ($entity['title'] ?? ''),
                    'date' => (string) $entity['date'],
                    'entity_type' => $entityType->value,
                    'entity_page' => $entityType->toPage(),
                    'headings' => array(),
                );
            }
            if ($entity['heading_index'] !== null) {
                $result[$id]['headings'][] = array(
                    'index' => (int) $entity['heading_index'],
                    'level' => (int) $entity['heading_level'],
                    'text' => (string) $entity['heading_text'],
                    'date' => (string) $entity['entry_date'],
                    'parent_index' => $entity['parent_index'] === null ? null : (int) $entity['parent_index'],
                    'anchor' => (string) $entity['anchor'],
                );
            }
        }
        $result = array_values($result);
        $Timer->finish(count($result));

        return $result;
    }

    private function parseDate(string $value): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date === false
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('Y-m-d') !== $value
        ) {
            throw new ImproperActionException('Calendar activity dates must use YYYY-MM-DD.');
        }
        return $date;
    }
}
