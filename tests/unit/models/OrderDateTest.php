<?php

declare(strict_types=1);

namespace Elabftw\Models;

class OrderDateTest extends \PHPUnit\Framework\TestCase
{
    public function testLabelAndValueOrders(): void
    {
        $this->assertSame('2026-09-23', OrderUploads::extractOrderDate("Bestellung Nr.\nSep 23, 2026Bestelldatum"));
        $this->assertSame('2026-10-19', OrderUploads::extractOrderDate('Bestelldatum: 19.10.2026'));
        $this->assertSame('2026-10-19', OrderUploads::extractOrderDate('19.10.2026Bestelldatum'));
        $this->assertSame('2026-01-02', OrderUploads::extractOrderDate("Bestelldatum\n2.1.2026"));
        $this->assertSame('2026-10-19', OrderUploads::extractOrderDate('Bestelldatum 2026-10-19'));
    }

    public function testInvalidAndUnrelatedDatesAreIgnored(): void
    {
        $this->assertNull(OrderUploads::extractOrderDate('Bestelldatum 31.02.2026'));
        $this->assertNull(OrderUploads::extractOrderDate('Bestelldatum 2026-13-01'));
        $this->assertNull(OrderUploads::extractOrderDate('Lieferdatum 19.10.2026'));
        $this->assertNull(OrderUploads::extractOrderDate('Bestelldatum unknown'));
    }
}
