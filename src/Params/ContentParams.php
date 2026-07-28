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

use BackedEnum;
use Elabftw\Enums\State;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\ContentParamsInterface;
use Elabftw\Services\Check;
use Elabftw\Services\Filter;
use InvalidArgumentException;
use Override;

use function mb_strlen;
use function filter_var;
use function _;
use function is_subclass_of;
use function sprintf;

class ContentParams implements ContentParamsInterface
{
    protected const int MIN_CONTENT_SIZE = 1;

    public function __construct(protected string $target, protected mixed $content) {}

    #[Override]
    public function getUnfilteredContent(): string
    {
        return $this->asString();
    }

    // maybe rename to something else, so we have getContent to get filtered content and this would be get nonemptystring
    #[Override]
    public function getContent(): mixed
    {
        // check for length
        if (mb_strlen($this->asString()) < self::MIN_CONTENT_SIZE) {
            throw new ImproperActionException(sprintf(_('Input is too short! (minimum: %d)'), self::MIN_CONTENT_SIZE));
        }
        return $this->content;
    }

    #[Override]
    public function getColumn(): string
    {
        return $this->target;
    }

    public function asString(): string
    {
        return (string) $this->content;
    }

    #[Override]
    public function getTarget(): string
    {
        return $this->target;
    }

    protected function getBody(): string
    {
        return Filter::body($this->asString());
    }

    protected function getBinary(): int
    {
        return Filter::toBinary($this->content);
    }

    protected function getCanJson(): string
    {
        return Check::visibility($this->asString());
    }

    protected function getCanBase(): int
    {
        return Check::basePermission($this->asInt())->value;
    }

    protected function getState(): int
    {
        return (int) $this->getEnum(State::class, $this->asInt())->value;
    }

    protected function asInt(): int
    {
        return (int) $this->content;
    }

    protected function getPositiveIntOrNull(): ?int
    {
        return $this->asInt() <= 0 ? null : $this->asInt();
    }

    protected function getNullableString(): ?string
    {
        if (empty($this->content)) {
            return null;
        }
        return $this->asString();
    }

    /**
     * Validate and normalize the JSON used for inline spreadsheet appearance defaults.
     */
    protected function getSpreadsheetDefaults(): ?string
    {
        if ($this->content === null || $this->asString() === '') {
            return null;
        }

        try {
            $defaults = json_decode($this->asString(), true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ImproperActionException('Invalid spreadsheet appearance defaults.');
        }
        if (!is_array($defaults)
            || !is_int($defaults['borderWidth'] ?? null)
            || $defaults['borderWidth'] < 0
            || $defaults['borderWidth'] > 20
            || !is_bool($defaults['alternateRows'] ?? null)
            || !is_bool($defaults['alternateColumns'] ?? null)
        ) {
            throw new ImproperActionException('Invalid spreadsheet appearance defaults.');
        }
        foreach (array('borderColor', 'cellColor', 'alternateRowColor', 'alternateColumnColor') as $colorKey) {
            if (!is_string($defaults[$colorKey] ?? null)
                || preg_match('/^#[0-9a-f]{6}$/i', $defaults[$colorKey]) !== 1
            ) {
                throw new ImproperActionException('Invalid spreadsheet appearance defaults.');
            }
        }

        return json_encode(array(
            'borderWidth' => $defaults['borderWidth'],
            'borderColor' => strtolower($defaults['borderColor']),
            'cellColor' => strtolower($defaults['cellColor']),
            'alternateRows' => $defaults['alternateRows'],
            'alternateRowColor' => strtolower($defaults['alternateRowColor']),
            'alternateColumns' => $defaults['alternateColumns'],
            'alternateColumnColor' => strtolower($defaults['alternateColumnColor']),
        ), JSON_THROW_ON_ERROR);
    }

    protected function getUrl(): string
    {
        if (filter_var($this->content, FILTER_VALIDATE_URL) === false) {
            throw new ImproperActionException('Invalid URL format.');
        }
        return $this->asString();
    }

    protected function getEnum(string $enumClass, int|string $input): BackedEnum
    {
        if (!is_subclass_of($enumClass, BackedEnum::class)) {
            throw new InvalidArgumentException(sprintf(
                'Provided class %s is not a valid BackedEnum.',
                $enumClass
            ));
        }
        return $enumClass::tryFrom($input) ?? throw new ImproperActionException(sprintf('Invalid value for enum %s.', $enumClass));
    }
}
