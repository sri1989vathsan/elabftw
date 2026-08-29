<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Params;

use Elabftw\Enums\BinaryValue;
use Elabftw\Exceptions\ImproperActionException;
use Override;

use function mb_strlen;
use function str_replace;
use function _;
use function sprintf;

final class StepParams extends ContentParams
{
    #[Override]
    public function getContent(): string | int | null
    {
        return match ($this->target) {
            'body' => $this->getStep(),
            'is_immutable' => BinaryValue::from((int) $this->content)->value,
            'deadline', 'finished_time' => $this->getNullableString(),
            'reagent' => $this->getReagent(),
            'quantity' => $this->getQuantity(),
            'duration_minutes' => $this->getPositiveIntOrNull(),
            default => throw new ImproperActionException('Incorrect parameter for steps.'),
        };
    }

    private function getReagent(): ?string
    {
        $content = $this->getNullableString();
        if ($content !== null && mb_strlen($content) > 255) {
            throw new ImproperActionException('Reagent name is too long (maximum: 255).');
        }
        return $content;
    }

    private function getQuantity(): ?string
    {
        $content = $this->getNullableString();
        if ($content !== null && mb_strlen($content) > 64) {
            throw new ImproperActionException('Quantity is too long (maximum: 64).');
        }
        return $content;
    }

    private function getStep(): string
    {
        // remove any | as they are used in the group_concat
        $content = str_replace('|', '', $this->asString());
        // check for length
        if (mb_strlen($content) < self::MIN_CONTENT_SIZE) {
            throw new ImproperActionException(sprintf(_('Input is too short! (minimum: %d)'), self::MIN_CONTENT_SIZE));
        }
        return $content;
    }
}
