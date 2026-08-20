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
use Elabftw\Elabftw\Tools;
use Elabftw\Enums\Action;
use Elabftw\Enums\BasePermissions;
use Elabftw\Enums\BinaryValue;
use Elabftw\Enums\BodyContentType;
use Elabftw\Enums\EntityType;
use Elabftw\Enums\AccessType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Links\Experiments2ExperimentsLinks;
use Elabftw\Services\Filter;
use Elabftw\Traits\InsertTagsTrait;
use PDO;
use Override;

use function _;
use function array_key_exists;
use function is_string;
use function mb_strlen;
use function sprintf;
use function trim;

/**
 * All about the experiments
 */
final class Experiments extends AbstractConcreteEntity
{
    use InsertTagsTrait;

    protected const string FORCE_TEMPLATE_KEY = 'force_exp_tpl';

    public EntityType $entityType = EntityType::Experiments;

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $hasGoal = $action === Action::Create && array_key_exists('experiment_goal', $reqBody);
        $hasConclusion = $action === Action::Create && array_key_exists('experiment_conclusion', $reqBody);
        $hasNotes = $action === Action::Create && array_key_exists('experiment_notes', $reqBody);
        $goal = $hasGoal ? $this->normalizeSummary($reqBody['experiment_goal'], 'Goals') : '';
        $conclusion = $hasConclusion
            ? $this->normalizeSummary($reqBody['experiment_conclusion'], 'Conclusion')
            : '';
        $notes = $hasNotes ? $this->normalizeSummary($reqBody['experiment_notes'], 'Notes') : '';
        $newId = parent::postAction($action, $reqBody);
        if ($hasGoal) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_GOAL, $newId, $goal);
        }
        if ($hasConclusion) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_CONCLUSION, $newId, $conclusion);
        }
        if ($hasNotes) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_NOTES, $newId, $notes);
        }
        return $newId;
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $hasGoal = $action === Action::Update && array_key_exists('experiment_goal', $params);
        $hasConclusion = $action === Action::Update && array_key_exists('experiment_conclusion', $params);
        $hasNotes = $action === Action::Update && array_key_exists('experiment_notes', $params);
        $goal = $hasGoal ? $this->normalizeSummary($params['experiment_goal'], 'Goals') : '';
        $conclusion = $hasConclusion
            ? $this->normalizeSummary($params['experiment_conclusion'], 'Conclusion')
            : '';
        $notes = $hasNotes ? $this->normalizeSummary($params['experiment_notes'], 'Notes') : '';
        if ($hasGoal) {
            unset($params['experiment_goal']);
        }
        if ($hasConclusion) {
            unset($params['experiment_conclusion']);
        }
        if ($hasNotes) {
            unset($params['experiment_notes']);
        }

        $result = parent::patch($action, $params);
        if ((!$hasGoal && !$hasConclusion && !$hasNotes) || $this->id === null) {
            return $result;
        }

        if ($hasGoal) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_GOAL, $this->id, $goal);
        }
        if ($hasConclusion) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_CONCLUSION, $this->id, $conclusion);
        }
        if ($hasNotes) {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_NOTES, $this->id, $notes);
        }
        return $this->readOne();
    }

    #[Override]
    public function readOne(): array
    {
        $result = parent::readOne();
        $result['experiment_goal'] = $this->getSummaryStore()->read(
            CustomUiDescriptions::EXPERIMENT_GOAL,
            (int) $result['id'],
        );
        $result['experiment_conclusion'] = $this->getSummaryStore()->read(
            CustomUiDescriptions::EXPERIMENT_CONCLUSION,
            (int) $result['id'],
        );
        $result['experiment_notes'] = $this->getSummaryStore()->read(
            CustomUiDescriptions::EXPERIMENT_NOTES,
            (int) $result['id'],
        );
        $this->entityData = $result;
        return $result;
    }

    #[Override]
    public function readShow(QueryParamsInterface $displayParams, bool $extended = false, string $can = 'canread'): array
    {
        $rows = $this->getSummaryStore()->enrichRows(
            CustomUiDescriptions::EXPERIMENT_GOAL,
            parent::readShow($displayParams, $extended, $can),
            'experiment_goal',
        );
        $rows = $this->getSummaryStore()->enrichRows(
            CustomUiDescriptions::EXPERIMENT_CONCLUSION,
            $rows,
            'experiment_conclusion',
        );
        return $this->getSummaryStore()->enrichRows(
            CustomUiDescriptions::EXPERIMENT_NOTES,
            $rows,
            'experiment_notes',
        );
    }

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
    ): int {
        // defaults
        $title = Filter::title($title ?? _('Untitled'));
        $date ??= new DateTimeImmutable();
        $body = Filter::body($body);
        if (empty($body)) {
            $body = null;
        }
        // figure out the custom id
        $customId ??= $this->getNextCustomId($category);

        // SQL for create experiments
        $sql = 'INSERT INTO experiments(team, title, date, body, category, status, elabid, canread_base, canwrite_base, canread, canwrite, canread_is_immutable, canwrite_is_immutable, metadata, custom_id, userid, content_type, rating, hide_main_text, created_from_type, created_from_id)
            VALUES(:team, :title, :date, :body, :category, :status, :elabid, :canread_base, :canwrite_base, :canread, :canwrite, :canread_is_immutable, :canwrite_is_immutable, :metadata, :custom_id, :userid, :content_type, :rating, :hide_main_text, :created_from_type, :created_from_id)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':team', $this->Users->team, PDO::PARAM_INT);
        $req->bindParam(':title', $title);
        $req->bindValue(':date', $date->format('Y-m-d'));
        $req->bindParam(':body', $body);
        $req->bindValue(':category', $category);
        $req->bindValue(':status', $status);
        $req->bindValue(':elabid', Tools::generateElabid());
        $req->bindValue(':canread_base', $canreadBase->value, PDO::PARAM_INT);
        $req->bindValue(':canwrite_base', $canwriteBase->value, PDO::PARAM_INT);
        $req->bindValue(':canread', $canread);
        $req->bindValue(':canwrite', $canwrite);
        $req->bindParam(':canread_is_immutable', $canreadIsImmutable, PDO::PARAM_INT);
        $req->bindParam(':canwrite_is_immutable', $canwriteIsImmutable, PDO::PARAM_INT);
        $req->bindParam(':metadata', $metadata);
        $req->bindParam(':custom_id', $customId, PDO::PARAM_INT);
        $req->bindParam(':userid', $this->Users->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':content_type', $contentType->value, PDO::PARAM_INT);
        $req->bindParam(':rating', $rating, PDO::PARAM_INT);
        $req->bindValue(':hide_main_text', $hideMainText->value, PDO::PARAM_INT);
        $this->Db->bindNullableInt($req, ':created_from_type', $createdFromType?->toInt());
        $this->Db->bindNullableInt($req, ':created_from_id', $createdFromId);
        $this->Db->execute($req);
        $newId = $this->Db->lastInsertId();

        $this->insertTags($tags, $newId);
        $this->addCreationToChangelog($newId, $createdFromType, $createdFromId);

        return $newId;
    }

    #[Override]
    public function duplicate(bool $copyFiles = false, bool $linkToOriginal = false): int
    {
        $this->canOrExplode(AccessType::Read);

        $newId = $this->copyEntityFrom(
            sourceEntity: $this,
            title: $this->entityData['title'] . ' I',
            copyFiles: $copyFiles,
        );

        if ($linkToOriginal) {
            $fresh = new self($this->Users, $newId);
            $ExperimentsLinks = new Experiments2ExperimentsLinks($fresh);
            $ExperimentsLinks->setId($this->id);
            $ExperimentsLinks->postAction(Action::Create, array());
        }

        $goal = $this->getSummaryStore()->read(CustomUiDescriptions::EXPERIMENT_GOAL, (int) $this->id);
        if ($goal !== '') {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_GOAL, $newId, $goal);
        }
        $conclusion = $this->getSummaryStore()->read(CustomUiDescriptions::EXPERIMENT_CONCLUSION, (int) $this->id);
        if ($conclusion !== '') {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_CONCLUSION, $newId, $conclusion);
        }
        $notes = $this->getSummaryStore()->read(CustomUiDescriptions::EXPERIMENT_NOTES, (int) $this->id);
        if ($notes !== '') {
            $this->getSummaryStore()->write(CustomUiDescriptions::EXPERIMENT_NOTES, $newId, $notes);
        }

        return $newId;
    }

    #[Override]
    protected function getCreatePermissionKey(): string
    {
        return 'users_canwrite_experiments';
    }

    private function getSummaryStore(): CustomUiDescriptions
    {
        return new CustomUiDescriptions();
    }

    private function normalizeSummary(mixed $summary, string $label): string
    {
        if ($summary === null) {
            return '';
        }
        if (!is_string($summary)) {
            throw new ImproperActionException(sprintf('%s must be text.', $label));
        }
        $summary = trim($summary);
        if (mb_strlen($summary) > CustomUiDescriptions::MAX_SUMMARY_LENGTH) {
            throw new ImproperActionException(sprintf('%s must be 1000 characters or fewer.', $label));
        }
        return $summary;
    }
}
