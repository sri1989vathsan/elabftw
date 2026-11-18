<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Enums;

/**
 * The two sizes of the interface: compact (the default) and comfortable (bigger controls, rows and text)
 */
enum UiSize: string
{
    case Compact = 'compact';
    case Comfortable = 'comfortable';
}
