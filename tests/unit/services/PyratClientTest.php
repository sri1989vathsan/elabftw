<?php

declare(strict_types=1);

namespace Elabftw\Services\Pyrat;

use Elabftw\Exceptions\ImproperActionException;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

final class PyratClientTest extends TestCase
{
    public function testDemoAnimalsAndCagesCanBeFiltered(): void
    {
        $Pyrat = new PyratClient(config: $this->demoConfig());

        $animals = $Pyrat->searchAnimals(array('cage' => 'C12'));
        $this->assertCount(2, $animals);
        $this->assertSame('M1234', $animals[0]['animal_id']);

        $cages = $Pyrat->searchCages(array('q' => 'C14'));
        $this->assertCount(1, $cages);
        $this->assertSame('C14', $cages[0]['cage_id']);
    }

    public function testScoresheetUrlUsesEntityPlaceholders(): void
    {
        $config = $this->demoConfig() + array('pyrat_scoresheet_url' => 'https://scores.example/{type}/{id}');
        $Pyrat = new PyratClient(config: $config);

        $this->assertSame('https://scores.example/animal/M%201', $Pyrat->getScoresheetUrl('animal', 'M 1'));
        $this->assertSame('https://scores.example/', $Pyrat->getScoresheetHomeUrl());
        $this->assertSame('', $Pyrat->getScoresheetUrl('unknown', 'M1'));
    }

    public function testNormalizesInstitutionalResponseShape(): void
    {
        $mock = new MockHandler(array(new Response(200, array(), json_encode(array(
            'data' => array('animals' => array(array(
                'animalID' => 'M88',
                'cage' => array('name' => 'C9'),
                'mouseLine' => 'C57BL/6J',
            ))),
        ), JSON_THROW_ON_ERROR))));
        $client = new Client(array('handler' => HandlerStack::create($mock)));
        $Pyrat = new PyratClient($client, $this->liveConfig());

        $animals = $Pyrat->searchAnimals(array('q' => 'M88'));
        $this->assertCount(1, $animals);
        $this->assertSame('M88', $animals[0]['animal_id']);
        $this->assertSame('C9', $animals[0]['cage']);
    }

    public function testRejectsCredentialRedirectToAnotherOrigin(): void
    {
        $config = $this->liveConfig();
        $config['pyrat_animals_path'] = 'https://attacker.example/animals';
        $Pyrat = new PyratClient(config: $config);

        $this->expectException(ImproperActionException::class);
        $this->expectExceptionMessage('configured base URL origin');
        $Pyrat->searchAnimals();
    }

    /** @return array<string, string> */
    private function demoConfig(): array
    {
        return array('pyrat_enabled' => '1', 'pyrat_demo_mode' => '1');
    }

    /** @return array<string, string> */
    private function liveConfig(): array
    {
        return array(
            'pyrat_enabled' => '1',
            'pyrat_demo_mode' => '0',
            'pyrat_base_url' => 'https://pyrat.example',
            'pyrat_auth_mode' => 'none',
            'pyrat_animals_path' => '/animals',
            'pyrat_verify_tls' => '1',
        );
    }
}
