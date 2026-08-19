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
use Elabftw\Enums\BodyContentType;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\State;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Services\CalendarActivityHeadingExtractor;
use Override;
use PDO;

use function array_map;
use function count;
use function implode;
use function sprintf;

/**
 * Read owned experiment/resource activity for the account calendar.
 *
 * This is deliberately computed from existing entity data and saved date
 * references, so the feature does not need its own schema migration.
 */
final class CalendarActivity extends AbstractRest
{
    private const int MAX_RANGE_DAYS = 62;

    public function __construct(
        private Users $Users,
        private CalendarActivityHeadingExtractor $HeadingExtractor = new CalendarActivityHeadingExtractor(),
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
    ): array
    {
        $dateClauses = array();
        $dates = array();
        $cursor = $from;
        while ($cursor <= $to) {
            $parameter = ':body_date_' . count($dates);
            $dateClauses[] = 'entity.body LIKE ' . $parameter;
            $dates[$parameter] = '%datetime="' . $cursor->format('Y-m-d') . '%';
            $cursor = $cursor->add(new DateInterval('P1D'));
        }

        $scopeSql = 'entity.team = :teamid AND entity.userid = :userid';
        if ($teamScoped) {
            // Team scope must still honor every entity's read permissions.
            $scopeSql = 'entity.team = :teamid'
                . (new CanSqlBuilder($this->Users, AccessType::Read))->getCanFilter();
        }

        $sql = sprintf(
            'SELECT entity.id, entity.title, entity.date, entity.body, entity.content_type
                FROM %s AS entity
                WHERE %s
                    AND entity.state IN (%d, %d)
                    AND (entity.date BETWEEN :from_date AND :to_date OR %s)
                ORDER BY entity.date ASC, entity.title ASC',
            $entityType->value,
            $scopeSql,
            State::Normal->value,
            State::Archived->value,
            implode(' OR ', $dateClauses),
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':teamid', $this->Users->team, PDO::PARAM_INT);
        $req->bindValue(':from_date', $from->format('Y-m-d'));
        $req->bindValue(':to_date', $to->format('Y-m-d'));
        foreach ($dates as $parameter => $pattern) {
            $req->bindValue($parameter, $pattern);
        }
        $this->Db->execute($req);

        $result = array();
        foreach ($req->fetchAll() as $entity) {
            $entityDate = (string) $entity['date'];
            $headings = $this->HeadingExtractor->extract(
                (string) ($entity['body'] ?? ''),
                BodyContentType::from((int) $entity['content_type']),
                $entityDate,
            );
            $hasDatedHeading = false;
            foreach ($headings as $heading) {
                if ($heading['date'] >= $from->format('Y-m-d') && $heading['date'] <= $to->format('Y-m-d')) {
                    $hasDatedHeading = true;
                    break;
                }
            }
            if (!$hasDatedHeading && ($entityDate < $from->format('Y-m-d') || $entityDate > $to->format('Y-m-d'))) {
                continue;
            }
            $result[] = array(
                'id' => (int) $entity['id'],
                'title' => (string) ($entity['title'] ?? ''),
                'date' => $entityDate,
                'entity_type' => $entityType->value,
                'entity_page' => $entityType->toPage(),
                'headings' => array_map(static fn(array $heading): array => array(
                    'index' => (int) $heading['index'],
                    'level' => (int) $heading['level'],
                    'text' => (string) $heading['text'],
                    'date' => (string) $heading['date'],
                    'parent_index' => $heading['parent_index'] === null ? null : (int) $heading['parent_index'],
                    'anchor' => (string) $heading['anchor'],
                ), $headings),
            );
        }
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
