<?php

declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Params;

use Elabftw\Enums\Entrypoint;
use Elabftw\Exceptions\ImproperActionException;

class UserParamsTest extends \PHPUnit\Framework\TestCase
{
    public function testValidUntilEmpty(): void
    {
        $params = new UserParams('valid_until', '');
        $this->assertEquals('3000-01-01', $params->getContent());
    }

    public function testValidUntil(): void
    {
        $input = '2023-02-03';
        $params = new UserParams('valid_until', $input);
        $this->assertEquals($input, $params->getContent());
    }

    public function testOrcid(): void
    {
        $orcid = '1234-5678-1212-0001';
        $params = new UserParams('orcid', $orcid);
        $this->assertEquals($orcid, $params->getContent());
    }

    public function testInvalidOrcidFormat(): void
    {
        $orcid = '1234-5678-1212-001';
        $params = new UserParams('orcid', $orcid);
        $this->expectException(ImproperActionException::class);
        $params->getContent();
    }

    public function testInvalidOrcidChecksum(): void
    {
        $orcid = '1234-5678-1212-000X';
        $params = new UserParams('orcid', $orcid);
        $this->expectException(ImproperActionException::class);
        $params->getContent();
    }

    public function testEntryPoint(): void
    {
        $entrypoint = Entrypoint::Experiments->value;
        $params = new UserParams('entrypoint', $entrypoint);
        $this->assertEquals($entrypoint, $params->getContent());
    }

    public function testInvalidEntryPointDefaultsToDashboard(): void
    {
        $entrypoint = 'test';
        $params = new UserParams('entrypoint', $entrypoint);
        $this->assertEquals(Entrypoint::Dashboard->value, $params->getContent());
    }

    public function testSpreadsheetDefaults(): void
    {
        $input = '{"borderWidth":2,"borderColor":"#AABBCC","cellColor":"#FFFFFF","alternateRows":true,"alternateRowColor":"#F6F7F8","alternateColumns":false,"alternateColumnColor":"#EEF6F7"}';
        $params = new UserParams('spreadsheet_defaults', $input);
        $this->assertSame(
            '{"borderWidth":2,"borderColor":"#aabbcc","cellColor":"#ffffff","alternateRows":true,"alternateRowColor":"#f6f7f8","alternateColumns":false,"alternateColumnColor":"#eef6f7"}',
            $params->getContent(),
        );
    }

    public function testInvalidSpreadsheetDefaults(): void
    {
        $params = new UserParams(
            'spreadsheet_defaults',
            '{"borderWidth":50,"borderColor":"red"}',
        );
        $this->expectException(ImproperActionException::class);
        $params->getContent();
    }
}
