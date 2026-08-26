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
use function array_is_list;
use function filter_var;
use function _;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;
use function is_subclass_of;
use function sprintf;
use function strlen;

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
     * Validate the account-wide defaults used by the date and title editor tools.
     */
    protected function getEditorDefaults(): ?string
    {
        if ($this->content === null || $this->asString() === '') {
            return null;
        }
        try {
            $defaults = json_decode($this->asString(), true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ImproperActionException('Invalid editor defaults.');
        }
        if (!is_array($defaults) || array_is_list($defaults)) {
            throw new ImproperActionException('Invalid editor defaults.');
        }
        $allowed = array('date', 'title');
        foreach ($defaults as $key => $value) {
            if (!in_array($key, $allowed, true) || !is_array($value) || array_is_list($value)) {
                throw new ImproperActionException('Invalid editor defaults.');
            }
        }
        $encoded = json_encode($defaults, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > 16384) {
            throw new ImproperActionException('Editor defaults are too large.');
        }
        return $encoded;
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
        if (is_array($defaults)) {
            // Backward compatible defaults for accounts/notebooks saved before
            // table-level appearance controls were introduced.
            $defaults += array(
                'cellPadding' => 6,
                'tableWidth' => 0,
                'tableAlignment' => 'left',
                'tableBorderWidth' => $defaults['borderWidth'] ?? 1,
                'tableBorderStyle' => 'solid',
                'tableBorderColor' => $defaults['borderColor'] ?? '#ced4da',
                'tableBackgroundColor' => '#ffffff',
                'tableNoBackground' => true,
                'tableCellSpacing' => 0,
                'cellStyle' => null,
            );
        }
        if (!is_array($defaults)
            || !is_int($defaults['borderWidth'] ?? null)
            || $defaults['borderWidth'] < 0
            || $defaults['borderWidth'] > 20
            || !is_int($defaults['cellPadding'] ?? null)
            || $defaults['cellPadding'] < 0
            || $defaults['cellPadding'] > 50
            || !is_bool($defaults['alternateRows'] ?? null)
            || !is_bool($defaults['alternateColumns'] ?? null)
            || !is_int($defaults['tableWidth'] ?? null)
            || $defaults['tableWidth'] < 0
            || $defaults['tableWidth'] > 100
            || !in_array($defaults['tableAlignment'] ?? null, array('left', 'center', 'right'), true)
            || !is_int($defaults['tableBorderWidth'] ?? null)
            || $defaults['tableBorderWidth'] < 0
            || $defaults['tableBorderWidth'] > 20
            || !in_array(
                $defaults['tableBorderStyle'] ?? null,
                array('solid', 'dashed', 'dotted', 'double', 'none'),
                true,
            )
            || !is_bool($defaults['tableNoBackground'] ?? null)
            || !is_int($defaults['tableCellSpacing'] ?? null)
            || $defaults['tableCellSpacing'] < 0
            || $defaults['tableCellSpacing'] > 50
        ) {
            throw new ImproperActionException('Invalid spreadsheet appearance defaults.');
        }
        foreach (array(
            'borderColor',
            'cellColor',
            'alternateRowColor',
            'alternateColumnColor',
            'tableBorderColor',
            'tableBackgroundColor',
        ) as $colorKey) {
            if (!is_string($defaults[$colorKey] ?? null)
                || preg_match('/^#[0-9a-f]{6}$/i', $defaults[$colorKey]) !== 1
            ) {
                throw new ImproperActionException('Invalid spreadsheet appearance defaults.');
            }
        }

        $cellStyle = $defaults['cellStyle'] ?? null;
        if ($cellStyle !== null
            && (!is_array($cellStyle)
                || !array_key_exists('backgroundColor', $cellStyle)
                || !array_key_exists('textColor', $cellStyle)
                || !is_int($cellStyle['borderWidth'] ?? null)
                || $cellStyle['borderWidth'] < 0
                || $cellStyle['borderWidth'] > 20
                || !in_array(
                    $cellStyle['borderStyle'] ?? null,
                    array('solid', 'dashed', 'dotted', 'double', 'none'),
                    true,
                )
                || !is_int($cellStyle['fontSize'] ?? null)
                || $cellStyle['fontSize'] < 6
                || $cellStyle['fontSize'] > 72
                || !is_bool($cellStyle['bold'] ?? null)
                || !is_bool($cellStyle['italic'] ?? null)
                || !is_bool($cellStyle['underline'] ?? null)
                || !in_array(
                    $cellStyle['fontFamily'] ?? null,
                    array(
                        '',
                        'Arial, sans-serif',
                        'Verdana, sans-serif',
                        'Georgia, serif',
                        "'Times New Roman', serif",
                        "'Courier New', monospace",
                    ),
                    true,
                )
                || !in_array(
                    $cellStyle['textAlign'] ?? null,
                    array('', 'left', 'center', 'right', 'justify'),
                    true,
                )
                || !in_array(
                    $cellStyle['verticalAlign'] ?? null,
                    array('', 'top', 'middle', 'bottom'),
                    true,
                )
                || (($cellStyle['backgroundColor'] ?? null) !== null
                    && (!is_string($cellStyle['backgroundColor'])
                        || preg_match('/^#[0-9a-f]{6}$/i', $cellStyle['backgroundColor']) !== 1))
                || !is_string($cellStyle['borderColor'] ?? null)
                || preg_match('/^#[0-9a-f]{6}$/i', $cellStyle['borderColor']) !== 1
                || (($cellStyle['textColor'] ?? null) !== null
                    && (!is_string($cellStyle['textColor'])
                        || preg_match('/^#[0-9a-f]{6}$/i', $cellStyle['textColor']) !== 1))
            )
        ) {
            throw new ImproperActionException('Invalid spreadsheet cell style defaults.');
        }

        $normalized = array(
            'borderWidth' => $defaults['borderWidth'],
            'borderColor' => strtolower($defaults['borderColor']),
            'cellColor' => strtolower($defaults['cellColor']),
            'cellPadding' => $defaults['cellPadding'],
            'alternateRows' => $defaults['alternateRows'],
            'alternateRowColor' => strtolower($defaults['alternateRowColor']),
            'alternateColumns' => $defaults['alternateColumns'],
            'alternateColumnColor' => strtolower($defaults['alternateColumnColor']),
            'tableWidth' => $defaults['tableWidth'],
            'tableAlignment' => $defaults['tableAlignment'],
            'tableBorderWidth' => $defaults['tableBorderWidth'],
            'tableBorderStyle' => $defaults['tableBorderStyle'],
            'tableBorderColor' => strtolower($defaults['tableBorderColor']),
            'tableBackgroundColor' => strtolower($defaults['tableBackgroundColor']),
            'tableNoBackground' => $defaults['tableNoBackground'],
            'tableCellSpacing' => $defaults['tableCellSpacing'],
        );
        if ($cellStyle !== null) {
            $normalized['cellStyle'] = array(
                'backgroundColor' => $cellStyle['backgroundColor'] === null
                    ? null
                    : strtolower($cellStyle['backgroundColor']),
                'borderColor' => strtolower($cellStyle['borderColor']),
                'borderStyle' => $cellStyle['borderStyle'],
                'borderWidth' => $cellStyle['borderWidth'],
                'fontFamily' => $cellStyle['fontFamily'],
                'fontSize' => $cellStyle['fontSize'],
                'bold' => $cellStyle['bold'],
                'italic' => $cellStyle['italic'],
                'underline' => $cellStyle['underline'],
                'textColor' => $cellStyle['textColor'] === null
                    ? null
                    : strtolower($cellStyle['textColor']),
                'textAlign' => $cellStyle['textAlign'],
                'verticalAlign' => $cellStyle['verticalAlign'],
            );
        }

        return json_encode($normalized, JSON_THROW_ON_ERROR);
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
