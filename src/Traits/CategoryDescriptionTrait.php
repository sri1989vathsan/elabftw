<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Traits;

use Elabftw\Enums\Action;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\CustomUiDescriptions;

use function array_key_exists;
use function count;

/**
 * Add fork-owned descriptions to category models while leaving status models untouched.
 */
trait CategoryDescriptionTrait
{
    abstract protected function getDescriptionScope(): string;

    public function readOne(): array
    {
        return $this->getDescriptionStore()->enrichRows(
            $this->getDescriptionScope(),
            array(parent::readOne()),
        )[0];
    }

    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        return $this->getDescriptionStore()->enrichRows(
            $this->getDescriptionScope(),
            parent::readAll($queryParams),
        );
    }

    public function readAllIgnoreState(): array
    {
        return $this->getDescriptionStore()->enrichRows(
            $this->getDescriptionScope(),
            parent::readAllIgnoreState(),
        );
    }

    public function postAction(Action $action, array $reqBody): int
    {
        $id = parent::postAction($action, $reqBody);
        if (array_key_exists('description', $reqBody)) {
            $this->getDescriptionStore()->write(
                $this->getDescriptionScope(),
                $id,
                (string) $reqBody['description'],
            );
        }
        return $id;
    }

    public function patch(Action $action, array $params): array
    {
        $hasDescription = array_key_exists('description', $params);
        $description = (string) ($params['description'] ?? '');
        unset($params['description']);

        if (count($params) > 0) {
            parent::patch($action, $params);
        } else {
            $this->canWriteOrExplode();
        }
        if ($hasDescription) {
            $this->getDescriptionStore()->write(
                $this->getDescriptionScope(),
                (int) $this->id,
                $description,
            );
        }
        return $this->readOne();
    }

    private function getDescriptionStore(): CustomUiDescriptions
    {
        return new CustomUiDescriptions();
    }
}
