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

use Elabftw\Enums\Action;
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Notifications\StepDeadline;
use Elabftw\Params\ContentParams;
use Elabftw\Params\StepParams;
use Elabftw\Services\Filter;
use Elabftw\Traits\SetIdTrait;
use Elabftw\Traits\SortableTrait;
use Override;
use PDO;

use function array_intersect;
use function array_keys;
use function _;
use function array_key_exists;
use function count;
use function in_array;
use function sprintf;
use function str_replace;

/**
 * All about the steps
 */
final class Steps extends AbstractRest
{
    use SortableTrait;
    use SetIdTrait;

    public function __construct(public AbstractEntity $Entity, ?int $id = null)
    {
        parent::__construct();
        $this->setId($id);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf('%s%d/steps/', $this->Entity->getApiPath(), $this->Entity->id ?? 0);
    }

    /**
     * Import a step from a complete step array
     * Used when importing from zip archive (json)
     *
     * @param array<string, mixed> $step
     */
    public function import(array $step): void
    {
        $this->Entity->canOrExplode(AccessType::Write);

        $body = str_replace('|', ' ', $step['body']);
        $sql = 'INSERT INTO ' . $this->Entity->entityType->value . '_steps (item_id, body, ordering, finished, finished_time)
            VALUES(:item_id, :body, :ordering, :finished, :finished_time)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        $req->bindParam(':body', $body);
        $req->bindParam(':ordering', $step['ordering'], PDO::PARAM_INT);
        $req->bindParam(':finished', $step['finished'], PDO::PARAM_INT);
        $req->bindParam(':finished_time', $step['finished_time']);
        $this->Db->execute($req);
    }

    /**
     * Create a step from https://schema.org/HowToStep
     * Example:
     * {
     *  "@id": "howtostep://bde30f48-b16c-4050-ba63-0c34d1bafb7d",
     *  "@type": "HowToStep",
     *  "position": 2,
     *  "creativeWorkStatus": "unfinished",
     *  "itemListElement": {
     *    "@id": "howtodirection://7c55611b-3400-48fa-bcc3-db05925b5ab8"
     *  }
     * },
     */
    public function importFromHowToStep(array $howToStep, string $body): void
    {
        $this->import(array(
            'body' => $body,
            'finished' => $howToStep['creativeWorkStatus'] === 'finished' ? 1 : 0,
            'finished_time' => $howToStep['temporal'] ?? null,
            'ordering' => $howToStep['position'] ?? null,
        ));
    }

    /**
     * Create a step from unflattened step
     * Example:
     *   "@type": "HowToStep",
     *   "position": 4,
     *   "creativeWorkStatus": "finished",
     *   "expires": "2024-05-19T04:24:54+02:00",
     *   "temporal": "2024-05-19T03:24:54+02:00",
     *   "itemListElement": {
     *     "@type":"HowToDirection",
     *     "text": "finished with deadline"
     *   }
     */
    public function importFromHowToStepOld(array $step): void
    {
        $stepArr = array();
        $stepArr['body'] = $step['itemListElement'][0]['text'];
        $stepArr['finished'] = $step['creativeWorkStatus'] === 'finished' ? 1 : 0;
        $stepArr['finished_time'] = $step['temporal'] ?? null;
        $stepArr['ordering'] = $step['position'] ?? null;
        $this->import($stepArr);
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT * FROM ' . $this->Entity->entityType->value . '_steps WHERE item_id = :id ORDER BY ordering';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->Entity->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $req->fetchAll();
    }

    #[Override]
    public function readOne(): array
    {
        $sql = 'SELECT * FROM ' . $this->Entity->entityType->value . '_steps WHERE id = :id AND item_id = :item_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->fetch($req);
    }

    // Copy Steps from one entity to another
    public function duplicate(AbstractEntity $targetEntity, int $id, int $newId): void
    {
        $sourceTable = $this->Entity->entityType->value;
        $targetTable = $targetEntity->entityType->value;
        $stepsql = sprintf('SELECT body, ordering, is_immutable, reagent, quantity, duration_minutes FROM %s_steps WHERE item_id = :id', $sourceTable);
        $stepreq = $this->Db->prepare($stepsql);
        $stepreq->bindParam(':id', $id, PDO::PARAM_INT);
        $this->Db->execute($stepreq);

        $sql = sprintf('INSERT INTO %s_steps (item_id, body, ordering, is_immutable, reagent, quantity, duration_minutes) VALUES (:item_id, :body, :ordering, :is_immutable, :reagent, :quantity, :duration_minutes)', $targetTable);
        $req = $this->Db->prepare($sql);
        $req->bindParam(':item_id', $newId, PDO::PARAM_INT);
        while ($step = $stepreq->fetch()) {
            $req->bindParam(':body', $step['body']);
            $req->bindParam(':ordering', $step['ordering'], PDO::PARAM_INT);
            $req->bindParam(':is_immutable', $step['is_immutable'], PDO::PARAM_INT);
            $req->bindParam(':reagent', $step['reagent']);
            $req->bindParam(':quantity', $step['quantity']);
            $req->bindParam(':duration_minutes', $step['duration_minutes'], PDO::PARAM_INT);
            $this->Db->execute($req);
        }
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->Entity->canOrExplode(AccessType::Write);
        $this->Entity->touch();
        match ($action) {
            Action::Finish => $this->toggleFinished(),
            Action::Notif => $this->toggleNotif(),
            Action::NotifDestroy => $this->destroyNotif(),
            Action::Update => (
                function () use ($params) {
                    // prevent updates to protected fields on immutable steps
                    $protected = array('body', 'ordering', 'is_immutable', 'reagent', 'quantity', 'duration_minutes');
                    $enforceImmutability = in_array($this->Entity->entityType->value, array('experiments', 'items'), true);
                    // if we're on experiments/items, prevent any change to is_immutable. It is only allowed on templates
                    if ($enforceImmutability && array_key_exists('is_immutable', $params)) {
                        throw new ImproperActionException(_('The immutability parameter cannot be modified from experiments or resources.'));
                    }
                    if ($enforceImmutability && $this->readOne()['is_immutable'] === 1
                        && count(array_intersect(array_keys($params), $protected)) > 0) {
                        throw new ImproperActionException(_('This step is immutable: it cannot be modified.'));
                    }
                    foreach ($params as $key => $value) {
                        // value can be null with deadline removal
                        $this->update(new StepParams($key, $value ?? ''));
                    }
                    if (array_key_exists('deadline', $params)) {
                        $this->syncLinkedTodo();
                    }
                }
            )(),
            Action::ForceLock => $this->setImmutable(1),
            Action::ForceUnlock => $this->setImmutable(0),
            default => throw new ImproperActionException('Invalid action for steps.'),
        };
        $Changelog = new Changelog($this->Entity);
        $Changelog->create(new ContentParams('steps', $action->value));
        if ($this->id) {
            return $this->readOne();
        }
        return $this->readAll();
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->Entity->canOrExplode(AccessType::Write);
        $this->Entity->touch();
        $Changelog = new Changelog($this->Entity);
        $Changelog->create(new ContentParams('steps', $action->value));
        return $this->create($reqBody['body'] ?? 'RTFM');
    }

    #[Override]
    public function destroy(): bool
    {
        $this->Entity->canOrExplode(AccessType::Write);
        $this->Entity->touch();
        $Changelog = new Changelog($this->Entity);
        /** @psalm-suppress PossiblyNullArgument */
        $Changelog->create(new ContentParams('steps', sprintf('Removed step with id: %d', $this->id)));

        $this->getStepDeadline()->destroy();

        $linkedTodolistId = StepTodolistLinks::unlink($this->Entity->entityType->value, (int) $this->id);
        if ($linkedTodolistId !== null) {
            new Todolist($this->Entity->Users, $linkedTodolistId)->destroyAsLinkedStep();
        }

        $sql = 'DELETE FROM ' . $this->Entity->entityType->value . '_steps WHERE id = :id AND item_id = :item_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function setImmutable(int $value): bool
    {
        $sql = sprintf(
            'UPDATE %s_steps SET is_immutable = :content WHERE item_id = :item_id',
            $this->Entity->entityType->value,
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':content', $value, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function update(StepParams $params): bool
    {
        $sql = sprintf(
            'UPDATE %s_steps SET %s = :content WHERE id = :id AND item_id = :item_id',
            $this->Entity->entityType->value,
            $params->getColumn(),
        );
        $req = $this->Db->prepare($sql);
        $req->bindValue(':content', $params->getContent());
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    private function create(string $body): int
    {
        $body = Filter::title($body);
        // make sure the newly added step is at the bottom
        // count the number of steps and add 1 to be sure we're last
        $ordering = count($this->readAll()) + 1;

        $sql = 'INSERT INTO ' . $this->Entity->entityType->value . '_steps (item_id, body, ordering) VALUES(:item_id, :body, :ordering)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        $req->bindValue(':body', $body);
        $req->bindParam(':ordering', $ordering, PDO::PARAM_INT);
        $this->Db->execute($req);

        return $this->Db->lastInsertId();
    }

    private function toggleFinished(): bool
    {
        $sql = sprintf(
            'UPDATE %s_steps
                SET finished = !finished,
                    finished_time = NOW(),
                    deadline = null,
                    deadline_notif = 0
                WHERE id = :id
                    AND item_id = :item_id',
            $this->Entity->entityType->value
        );
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        $res = $this->Db->execute($req);

        // delete potential notification if step is finished
        $finished = $this->readOne()['finished'] === 1;
        if ($finished) {
            $this->getStepDeadline()->destroy();
        }

        // keep a linked to-do (if any) in sync: this step's own deadline
        // column was just cleared above (toggling either way), but the
        // reflected to-do stays around as a record -- just marked done or
        // reopened to match.
        $linkedTodolistId = StepTodolistLinks::findTodolistId($this->Entity->entityType->value, (int) $this->id);
        if ($linkedTodolistId !== null) {
            new Todolist($this->Entity->Users, $linkedTodolistId)->syncFromLinkedStep(array('completed' => $finished));
        }

        return $res;
    }

    private function toggleNotif(): bool
    {
        $this->getStepDeadline($this->readOne()['deadline'])->create();

        return $this->setDeadlineNotif('!deadline_notif');
    }

    private function destroyNotif(): bool
    {
        $this->getStepDeadline()->destroy();

        return $this->setDeadlineNotif('0');
    }

    /**
     * set the deadline_notif column so we know whether this step has a notif set for the deadline
     */
    private function setDeadlineNotif(string $value): bool
    {
        $sql = sprintf(
            'UPDATE %s_steps SET deadline_notif = %s WHERE id = :id AND item_id = :item_id',
            $this->Entity->entityType->value,
            $value,
        );
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $req->bindParam(':item_id', $this->Entity->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Mirror this step's own deadline as a linked to-do task, so it shows
     * up on the team's Todolist board instead of only living on the Steps
     * tab. Called after any Action::Update that touches 'deadline':
     * creates the link on the first non-empty deadline, keeps title/
     * deadline in sync on later edits, and removes the reflected to-do
     * entirely once the deadline is cleared (toggleFinished() handles the
     * "step is done" case separately, since it clears deadline too but the
     * to-do should stay as a completed record, not disappear).
     */
    private function syncLinkedTodo(): void
    {
        $step = $this->readOne();
        $entityType = $this->Entity->entityType->value;
        $stepId = (int) $this->id;
        $existingTodolistId = StepTodolistLinks::findTodolistId($entityType, $stepId);

        if (empty($step['deadline'])) {
            if ($existingTodolistId !== null) {
                StepTodolistLinks::unlink($entityType, $stepId);
                new Todolist($this->Entity->Users, $existingTodolistId)->destroyAsLinkedStep();
            }
            return;
        }

        $body = sprintf(_('Step: %s'), Filter::toPureString($step['body']));
        if ($existingTodolistId !== null) {
            new Todolist($this->Entity->Users, $existingTodolistId)->syncFromLinkedStep(array(
                'content' => $body,
                'deadline' => $step['deadline'],
            ));
            return;
        }

        $Task = new Todolist($this->Entity->Users);
        $newTodolistId = $Task->postAction(Action::Create, array(
            'content' => $body,
            'deadline' => $step['deadline'],
        ));
        StepTodolistLinks::link($entityType, $stepId, $newTodolistId);
        new TodolistEntityLinks($this->Entity->Users, new Todolist($this->Entity->Users, $newTodolistId))
            ->postAction(Action::Create, array('entity_type' => $entityType, 'entity_id' => $this->Entity->id));
    }

    private function getStepDeadline(string $deadline = ''): StepDeadline
    {
        /** @psalm-suppress PossiblyNullArgument */
        return new StepDeadline(
            $this->Entity->Users,
            $this->id,
            $this->Entity->id,
            $this->Entity->entityType->toPage(),
            $deadline,
        );
    }
}
