<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services\Pyrat;

use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Models\Users\Users;

use function array_filter;
use function array_map;
use function explode;
use function in_array;
use function trim;

final class PyratAccess
{
    /** @param array<string, mixed> $config */
    public static function assertAllowed(Users $requester, array $config): void
    {
        if (!self::isAllowed($requester->isSysadmin(), $requester->team, (string) ($config['pyrat_allowed_teams'] ?? ''))) {
            throw new UnauthorizedException('Your eLabFTW team is not allowed to access PyRAT.');
        }
    }

    public static function isAllowed(bool $isSysadmin, ?int $team, string $allowedTeams): bool
    {
        if ($isSysadmin) {
            return true;
        }
        $teams = array_filter(array_map('trim', explode(',', $allowedTeams)), static fn(string $value): bool => $value !== '');
        return $team !== null && in_array((string) $team, $teams, true);
    }
}
