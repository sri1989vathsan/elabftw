<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Services;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Elabftw\Elabftw\Db;
use Elabftw\Enums\State;
use PDO;

use function array_merge;
use function hash;
use function html_entity_decode;
use function mb_strcut;
use function preg_replace;
use function rtrim;
use function sprintf;
use function str_replace;
use function strlen;
use function strip_tags;
use function trim;

/**
 * Render personal to-dos and owned entity-step deadlines as an RFC 5545 feed.
 */
final class AccountCalendarFeed
{
    private Db $Db;

    private readonly DateTimeZone $utc;

    public function __construct(
        private readonly int $userid,
        private readonly string $siteUrl,
    ) {
        $this->Db = Db::getConnection();
        $this->utc = new DateTimeZone('UTC');
    }

    public function render(): string
    {
        $lines = array(
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//eLabFTW//Account task calendar//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:eLabFTW tasks',
            'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
            'X-PUBLISHED-TTL:PT15M',
        );
        $stamp = (new DateTimeImmutable('now', $this->utc))->format('Ymd\THis\Z');
        foreach ($this->getEntries() as $entry) {
            $deadline = new DateTimeImmutable($entry['deadline'], $this->utc);
            $end = $deadline->add(new DateInterval('PT30M'));
            $description = $entry['description'];
            if ($entry['notes'] !== null && trim($entry['notes']) !== '') {
                $description .= "\n\n" . $entry['notes'];
            }
            $lines = array_merge($lines, array(
                'BEGIN:VEVENT',
                'UID:' . hash('sha256', $this->siteUrl . '|' . $this->userid . '|' . $entry['key']) . '@elabftw',
                'DTSTAMP:' . $stamp,
                'DTSTART:' . $deadline->format('Ymd\THis\Z'),
                'DTEND:' . $end->format('Ymd\THis\Z'),
                'SUMMARY:' . $this->escape($entry['summary']),
                'DESCRIPTION:' . $this->escape($description),
                'URL:' . $this->escape($entry['url']),
                'STATUS:CONFIRMED',
            ));
            if ($entry['reminder_minutes'] !== null) {
                $minutes = (int) $entry['reminder_minutes'];
                $lines = array_merge($lines, array(
                    'BEGIN:VALARM',
                    'ACTION:DISPLAY',
                    'DESCRIPTION:' . $this->escape($entry['summary']),
                    'TRIGGER:' . ($minutes === 0 ? 'PT0M' : sprintf('-PT%dM', $minutes)),
                    'END:VALARM',
                ));
            }
            $lines[] = 'END:VEVENT';
        }
        $lines[] = 'END:VCALENDAR';
        return implode("\r\n", array_map($this->fold(...), $lines)) . "\r\n";
    }

    private function getEntries(): array
    {
        return array_merge($this->getTodos(), $this->getStepDeadlines('experiments'), $this->getStepDeadlines('items'));
    }

    private function getTodos(): array
    {
        $sql = 'SELECT id, body, notes, deadline, reminder_minutes
            FROM todolist
            WHERE userid = :userid AND deadline IS NOT NULL
            ORDER BY deadline ASC';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_map(function (array $row): array {
            return array(
                'key' => 'todo-' . $row['id'],
                'summary' => $this->plainText($row['body']),
                'description' => 'Personal eLabFTW to-do',
                'notes' => $row['notes'] === null ? null : $this->plainText($row['notes']),
                'deadline' => $row['deadline'],
                'reminder_minutes' => $row['reminder_minutes'],
                'url' => rtrim($this->siteUrl, '/') . '/?task=' . $row['id'],
            );
        }, $req->fetchAll());
    }

    private function getStepDeadlines(string $entityType): array
    {
        $page = $entityType === 'experiments' ? 'experiments.php' : 'database.php';
        $sql = sprintf(
            'SELECT entity.id AS entity_id, entity.title AS entity_title,
                entity_steps.id AS step_id, entity_steps.body AS step_body,
                entity_steps.deadline, entity_steps.deadline_notif
            FROM %1$s AS entity
            INNER JOIN %1$s_steps AS entity_steps ON entity_steps.item_id = entity.id
            WHERE entity.userid = :userid
                AND entity.state = :state
                AND entity_steps.finished = 0
                AND entity_steps.deadline IS NOT NULL
            ORDER BY entity_steps.deadline ASC, entity_steps.ordering ASC',
            $entityType,
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':userid', $this->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        return array_map(function (array $row) use ($entityType, $page): array {
            $entityTitle = $this->plainText($row['entity_title']);
            return array(
                'key' => sprintf('step-%s-%s', $entityType, $row['step_id']),
                'summary' => $this->plainText($row['step_body']),
                'description' => sprintf('Step in: %s', $entityTitle),
                'notes' => null,
                'deadline' => $row['deadline'],
                'reminder_minutes' => (int) $row['deadline_notif'] === 1 ? 30 : null,
                'url' => sprintf(
                    '%s/%s?mode=view&id=%d#step_view_%d',
                    rtrim($this->siteUrl, '/'),
                    $page,
                    $row['entity_id'],
                    $row['step_id'],
                ),
            );
        }, $req->fetchAll());
    }

    private function plainText(string $value): string
    {
        $plain = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        return trim((string) preg_replace('/\s+/u', ' ', $plain));
    }

    private function escape(string $value): string
    {
        $value = str_replace(array("\r\n", "\r"), "\n", $value);
        return str_replace(
            array('\\', ';', ',', "\n"),
            array('\\\\', '\\;', '\\,', '\\n'),
            $value,
        );
    }

    /**
     * Fold content lines at 75 octets without cutting a UTF-8 sequence.
     */
    private function fold(string $line): string
    {
        $folded = '';
        $first = true;
        while (strlen($line) > ($first ? 75 : 74)) {
            $limit = $first ? 75 : 74;
            $chunk = mb_strcut($line, 0, $limit, 'UTF-8');
            $folded .= ($first ? '' : ' ') . $chunk . "\r\n";
            $line = mb_strcut($line, strlen($chunk), null, 'UTF-8');
            $first = false;
        }
        return $folded . ($first ? '' : ' ') . $line;
    }
}
