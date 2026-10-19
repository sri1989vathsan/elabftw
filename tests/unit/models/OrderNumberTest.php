<?php

declare(strict_types=1);

namespace Elabftw\Models;

class OrderNumberTest extends \PHPUnit\Framework\TestCase
{
    public function testNumericOrderNumbers(): void
    {
        $this->assertSame('4500123456', OrderUploads::extractOrderNumber('4500123456Bestellung Nr.'));
        $this->assertSame('4500123456', OrderUploads::extractOrderNumber('Bestellung Nr. 4500123456'));
        $this->assertSame('001234', OrderUploads::extractOrderNumber('Bestellung Nr.: 001234'));
    }

    public function testBlankFieldDoesNotConsumeOtherFields(): void
    {
        foreach (array('Bestellung Nr. Sep', "Bestellung Nr.\nSep", 'Bestellung Nr.',
            "Bestellung Nr.\n26048466 Beschaffungs-ID", 'Bestellung Nr. 19.10.2026',
            '19.10.2026Bestellung Nr.', 'Bestellung Nr. 2026-10-19') as $text) {
            $this->assertNull(OrderUploads::extractOrderNumber($text), $text);
        }
    }
}
