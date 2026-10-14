<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\AccessType;
use Elabftw\Enums\Action;
use Elabftw\Enums\EntityType;
use Elabftw\Exceptions\ForbiddenException;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Models\Notifications\StepAssigned;
use Elabftw\Models\Notifications\StepFinished;
use Elabftw\Models\Users\Users;
use Elabftw\Services\Filter;
use PDO;

use function _;
use function array_diff;
use function array_keys;
use function preg_match;
use function preg_quote;
use function sprintf;

/**
 * "@Full Name" in the text of a step puts that step on the mentioned
 * person's to-do list (a task of their own, linked to the entry) and lets
 * them know. The text is the single source of truth: which people are
 * mentioned is read from it every time the step is saved, so editing the
 * step keeps the tasks in step, and taking a name out removes their task.
 */
final class StepMentions
{
    private Db $Db;

    public function __construct(private AbstractEntity $Entity)
    {
        $this->Db = Db::getConnection();
    }

    /** Creates, updates or removes the mentioned people's tasks for this step. */
    public function sync(int $stepId, string $body, ?string $deadline): void
    {
        $text = Filter::toPureString($body);
        $mentioned = $this->findMentioned($text);
        $existing = $this->readLinks($stepId);
        $title = sprintf(_('Step: %s'), $text);

        foreach (array_diff(array_keys($existing), array_keys($mentioned)) as $userid) {
            $this->removeTask((int) $userid, $existing[$userid]);
        }
        foreach ($mentioned as $userid => $fullname) {
            $target = new Users($userid, $this->Entity->Users->team);
            if (isset($existing[$userid])) {
                $params = array('content' => $title);
                if (!empty($deadline)) {
                    $params['deadline'] = $deadline;
                }
                new Todolist($target, $existing[$userid])->syncFromLinkedStep($params);
                $this->linkTaskToEntry($target, $existing[$userid]);
                continue;
            }
            // Whoever can edit the entry chose to assign this step, so the
            // person gets it even if they cannot open the entry (it is shared
            // with owner and admins only, say). The task always links to the
            // entry; only the notification leaves its name out for someone
            // who cannot open it.
            $readable = $this->canRead($target);
            $params = array('content' => $title);
            if (!empty($deadline)) {
                $params['deadline'] = $deadline;
            }
            $taskId = new Todolist($target)->postAction(Action::Create, $params);
            $this->saveLink($stepId, $userid, $taskId);
            $this->linkTaskToEntry($target, $taskId);
            new StepAssigned(
                $target,
                $this->Entity->Users,
                $this->Entity->entityType->toPage(),
                (int) $this->Entity->id,
                $readable ? (string) ($this->Entity->entityData['title'] ?? '') : '',
            )->create();
        }
    }

    /** Puts the link to the experiment, template or resource on the assignee's task (once). */
    private function linkTaskToEntry(Users $target, int $taskId): void
    {
        new TodolistEntityLinks($target, new Todolist($target, $taskId))
            ->postAction(Action::Create, array('entity_type' => $this->entityType(), 'entity_id' => $this->Entity->id));
    }

    /** Marks the mentioned people's tasks done or open, following the step. */
    public function syncFinished(int $stepId, bool $finished): void
    {
        foreach ($this->readLinks($stepId) as $userid => $taskId) {
            new Todolist(new Users($userid, $this->Entity->Users->team), $taskId)
                ->syncFromLinkedStep(array('completed' => $finished));
        }
    }

    /**
     * The step was completed on the entry's own page: whoever assigned it and
     * everybody it was assigned to (except the person who did it) is told --
     * not the other people who merely have access to the entry.
     */
    public function notifyFinished(int $stepId, string $stepBody): void
    {
        self::notifyParticipants(
            $this->entityType(),
            $stepId,
            $this->Entity->Users,
            $this->Entity->entityType,
            (int) $this->Entity->id,
            (string) ($this->Entity->entityData['title'] ?? ''),
            Filter::toPureString($stepBody),
        );
    }

    /**
     * Assigner and assignees of a step, minus whoever just completed it. A
     * person who cannot open the entry is told without its name.
     */
    private static function notifyParticipants(
        string $entityTypeValue,
        int $stepId,
        Users $actor,
        EntityType $type,
        int $entityId,
        string $title,
        string $step,
    ): void {
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'SELECT assigner_userid, userid FROM custom_step_mentions WHERE entity_type = :entity_type AND step_id = :step_id',
        );
        $req->bindValue(':entity_type', $entityTypeValue);
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $Db->execute($req);
        $recipients = array();
        foreach ($req->fetchAll() as $row) {
            if ($row['assigner_userid'] !== null) {
                $recipients[(int) $row['assigner_userid']] = true;
            }
            $recipients[(int) $row['userid']] = true;
        }
        unset($recipients[(int) $actor->userData['userid']]);
        foreach (array_keys($recipients) as $userid) {
            $target = new Users($userid, $actor->team);
            try {
                $type->toInstance($target, $entityId)->canOrExplode(AccessType::Read);
                $name = $title;
            } catch (ForbiddenException | IllegalActionException | ImproperActionException | ResourceNotFoundException) {
                $name = '';
            }
            new StepFinished($target, $actor, $type->toPage(), $entityId, $name, $step)->create();
        }
    }

    /**
     * An assignee ticked (or reopened) their own to-do for a step: the step is
     * completed (or reopened) for everyone it was assigned to, and the
     * assigner and the other assignees are told.
     */
    public static function taskCompleted(int $todolistId, Users $actor, bool $completed): void
    {
        $Db = Db::getConnection();
        $req = $Db->prepare('SELECT entity_type, step_id, assigner_userid FROM custom_step_mentions WHERE todolist_id = :id');
        $req->bindValue(':id', $todolistId, PDO::PARAM_INT);
        $Db->execute($req);
        $link = $req->fetch();
        $type = $link === false ? null : EntityType::tryFrom((string) $link['entity_type']);
        if ($link === false || $type === null) {
            return;
        }
        $stepId = (int) $link['step_id'];
        // $type->value is one of EntityType's own values, never user input
        $req = $Db->prepare(sprintf('SELECT body, item_id FROM %s_steps WHERE id = :id', $type->value));
        $req->bindValue(':id', $stepId, PDO::PARAM_INT);
        $Db->execute($req);
        $step = $req->fetch();
        if ($step === false) {
            return;
        }
        // one assignee completing (or reopening) their part does it for the step
        // and for everyone else it was assigned to
        $finished = $completed;
        $req = $Db->prepare(sprintf(
            'UPDATE %s_steps SET finished = :finished, finished_time = %s WHERE id = :id',
            $type->value,
            $finished ? 'NOW()' : 'NULL',
        ));
        $req->bindValue(':finished', (int) $finished, PDO::PARAM_INT);
        $req->bindValue(':id', $stepId, PDO::PARAM_INT);
        $Db->execute($req);

        // the other assignees' tasks follow, and so does the one the step itself
        // reflects on the author's list (no hook fires from here: only a user's
        // own tick on a task goes through Todolist::patch)
        $req = $Db->prepare(
            'SELECT userid, todolist_id FROM custom_step_mentions WHERE entity_type = :entity_type AND step_id = :step_id AND todolist_id <> :self',
        );
        $req->bindValue(':entity_type', $type->value);
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $req->bindValue(':self', $todolistId, PDO::PARAM_INT);
        $Db->execute($req);
        foreach ($req->fetchAll() as $other) {
            new Todolist(new Users((int) $other['userid'], $actor->team), (int) $other['todolist_id'])
                ->syncFromLinkedStep(array('completed' => $finished));
        }
        $reflected = StepTodolistLinks::findTodolistId($type->value, $stepId);
        if ($reflected !== null) {
            new Todolist($actor, $reflected)->syncFromLinkedStep(array('completed' => $finished));
        }

        if (!$completed) {
            return;
        }
        $req = $Db->prepare(sprintf('SELECT title FROM %s WHERE id = :id', $type->value));
        $req->bindValue(':id', (int) $step['item_id'], PDO::PARAM_INT);
        $Db->execute($req);
        self::notifyParticipants(
            $type->value,
            $stepId,
            $actor,
            $type,
            (int) $step['item_id'],
            (string) $req->fetchColumn(),
            Filter::toPureString((string) $step['body']),
        );
    }

    /** The step is gone: so are the tasks it created. */
    public function removeAll(int $stepId): void
    {
        foreach ($this->readLinks($stepId) as $userid => $taskId) {
            $this->removeTask($userid, $taskId);
        }
    }

    /** @return array<int, string> userid => full name of the team members named in the text */
    private function findMentioned(string $text): array
    {
        if (!str_contains($text, '@')) {
            return array();
        }
        $sql = 'SELECT users.userid, CONCAT(users.firstname, " ", users.lastname) AS fullname
            FROM users
            INNER JOIN users2teams ON users2teams.users_id = users.userid AND users2teams.teams_id = :team
            WHERE users2teams.is_archived = 0';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->Entity->Users->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        $found = array();
        foreach ($req->fetchAll() as $user) {
            $userid = (int) $user['userid'];
            if ($userid === (int) $this->Entity->Users->userData['userid']) {
                continue;
            }
            if (preg_match('/@' . preg_quote((string) $user['fullname'], '/') . '(?=\s|$|[.,;:!?])/u', $text) === 1) {
                $found[$userid] = (string) $user['fullname'];
            }
        }

        return $found;
    }

    /** @return array<int, int> userid => task id */
    private function readLinks(int $stepId): array
    {
        $req = $this->Db->prepare(
            'SELECT userid, todolist_id FROM custom_step_mentions WHERE entity_type = :entity_type AND step_id = :step_id',
        );
        $req->bindValue(':entity_type', $this->entityType());
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $this->Db->execute($req);
        $links = array();
        foreach ($req->fetchAll() as $row) {
            $links[(int) $row['userid']] = (int) $row['todolist_id'];
        }

        return $links;
    }

    private function saveLink(int $stepId, int $userid, int $taskId): void
    {
        $req = $this->Db->prepare(
            'INSERT INTO custom_step_mentions (entity_type, step_id, userid, assigner_userid, todolist_id)
                VALUES (:entity_type, :step_id, :userid, :assigner, :todolist_id)
                ON DUPLICATE KEY UPDATE todolist_id = VALUES(todolist_id)',
        );
        $req->bindValue(':entity_type', $this->entityType());
        $req->bindValue(':step_id', $stepId, PDO::PARAM_INT);
        $req->bindValue(':userid', $userid, PDO::PARAM_INT);
        $req->bindValue(':assigner', (int) $this->Entity->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':todolist_id', $taskId, PDO::PARAM_INT);
        $this->Db->execute($req);
    }

    private function removeTask(int $userid, int $taskId): void
    {
        // the link row goes with the task (ON DELETE CASCADE)
        new Todolist(new Users($userid, $this->Entity->Users->team), $taskId)->destroyAsLinkedStep();
    }

    /** People who cannot open the entry are not handed its title through a task. */
    private function canRead(Users $target): bool
    {
        return $this->can($target, AccessType::Read);
    }

    private function can(Users $target, AccessType $access): bool
    {
        try {
            $entity = new ($this->Entity::class)($target, $this->Entity->id);
            $entity->canOrExplode($access);
        } catch (ForbiddenException | IllegalActionException | ImproperActionException | ResourceNotFoundException) {
            return false;
        }

        return true;
    }

    private function entityType(): string
    {
        return $this->Entity->entityType->value;
    }
}
