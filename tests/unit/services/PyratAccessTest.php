<?php

declare(strict_types=1);

namespace Elabftw\Services\Pyrat;

use PHPUnit\Framework\TestCase;

final class PyratAccessTest extends TestCase
{
    public function testSysadminIsAlwaysAllowed(): void
    {
        $this->assertTrue(PyratAccess::isAllowed(true, null, ''));
    }

    public function testOnlyConfiguredTeamsAreAllowed(): void
    {
        $this->assertTrue(PyratAccess::isAllowed(false, 3, '1, 3,7'));
        $this->assertFalse(PyratAccess::isAllowed(false, 4, '1,3,7'));
        $this->assertFalse(PyratAccess::isAllowed(false, 1, ''));
    }
}
