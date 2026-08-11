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

    public function testPrimaryFg(): void
    {
        $params = new UserParams('primary_fg', 'A1B2C3');
        $this->assertSame('a1b2c3', $params->getContent());
        $params = new UserParams('primary_fg', null);
        $this->assertNull($params->getContent());
        $params = new UserParams('primary_fg', '');
        $this->assertNull($params->getContent());
        $params = new UserParams('primary_fg', '#fff');
        $this->expectException(ImproperActionException::class);
        $params->getContent();
    }

    public function testDefaultReadWriteBase(): void
    {
        $params = new UserParams('default_read_base', 10);
        $this->assertSame(10, $params->getContent());
        $params = new UserParams('default_write_base', 10);
        $this->assertSame(10, $params->getContent());
    }

    public function testSpreadsheetDefaults(): void
    {
        $input = '{"borderWidth":2,"borderColor":"#AABBCC","cellColor":"#FFFFFF","alternateRows":true,"alternateRowColor":"#F6F7F8","alternateColumns":false,"alternateColumnColor":"#EEF6F7"}';
        $params = new UserParams('spreadsheet_defaults', $input);
        $result = json_decode($params->getContent(), true, 8, JSON_THROW_ON_ERROR);
        $this->assertSame(2, $result['borderWidth']);
        $this->assertSame('#aabbcc', $result['borderColor']);
        $this->assertSame('#ffffff', $result['cellColor']);
    }

    public function testSpreadsheetCellStyleDefaults(): void
    {
        $input = '{"borderWidth":2,"borderColor":"#AABBCC","cellColor":"#FFFFFF","alternateRows":true,"alternateRowColor":"#F6F7F8","alternateColumns":false,"alternateColumnColor":"#EEF6F7","cellStyle":{"backgroundColor":null,"borderColor":"#112233","borderStyle":"dashed","borderWidth":3,"fontFamily":"Arial, sans-serif","fontSize":14,"bold":true,"italic":false,"underline":true,"textColor":"#445566","textAlign":"center","verticalAlign":"middle"}}';
        $params = new UserParams('spreadsheet_defaults', $input);
        $result = json_decode($params->getContent(), true, 8, JSON_THROW_ON_ERROR);
        $this->assertNull($result['cellStyle']['backgroundColor']);
        $this->assertSame('#112233', $result['cellStyle']['borderColor']);
        $this->assertSame('dashed', $result['cellStyle']['borderStyle']);
        $this->assertSame(3, $result['cellStyle']['borderWidth']);
        $this->assertSame('Arial, sans-serif', $result['cellStyle']['fontFamily']);
        $this->assertSame('#445566', $result['cellStyle']['textColor']);
        $this->assertSame('center', $result['cellStyle']['textAlign']);
        $this->assertSame('middle', $result['cellStyle']['verticalAlign']);
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
