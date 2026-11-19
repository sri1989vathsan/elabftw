<?php

declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2024 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Enums;

use Elabftw\Exceptions\ImproperActionException;

use function array_filter;
use function array_map;
use function count;

class EnumsTest extends \PHPUnit\Framework\TestCase
{
    public function testApiEndpoint(): void
    {
        $this->assertIsArray(ApiEndpoint::getCases());
    }

    public function testEntrypoint(): void
    {
        array_map(
            fn(Entrypoint $case) => $this->assertStringEndsWith('.php', $case->toPage()),
            Entrypoint::cases(),
        );
    }

    public function testLanguage(): void
    {
        $this->assertIsArray(Language::getAllHuman());
        $this->assertEquals('ca', Language::Catalan->toCalendar());
    }

    public function testMeaning(): void
    {
        $this->assertIsArray(Meaning::getAssociativeArray());
    }

    public function testScope(): void
    {
        $this->assertIsString(Scope::toIcon(Scope::User));
    }

    public function testSort(): void
    {
        $this->assertIsString(Sort::Asc->toFa());
    }

    public function testEnforeMfa(): void
    {
        $this->assertIsString(EnforceMfa::toHuman(EnforceMfa::Admins));
        $this->assertIsArray(EnforceMfa::getAssociativeArray());
    }

    public function testEntityType(): void
    {
        $this->assertSame('templates.php', EntityType::Experiments->toTemplatePage());
        $this->assertSame('experiments-categories.php', EntityType::Experiments->toCategoryPage());
        $this->assertSame('experiments-status.php', EntityType::Experiments->toStatusPage());
    }

    public function testCurrency(): void
    {
        $this->assertIsString(Currency::NOK->toHuman());
        $this->assertIsString(Currency::DKK->toSymbol());
        $this->assertIsArray(Currency::getAssociativeArray());
    }

    public function testUnit(): void
    {
        $this->assertSame('Bar', Units::Bar->toHuman());
        $this->assertSame('Metre', Units::Metre->toHuman());
    }

    public function testApiSubModels(): void
    {
        array_map(
            fn(EntityType $case) => $this->assertIsArray(
                ApiSubModels::validSubModelsForEndpoint(ApiEndpoint::from($case->value)),
            ),
            EntityType::cases(),
        );
        $this->assertIsArray(ApiSubModels::validSubModelsForEndpoint(ApiEndpoint::Teams));
        $this->assertIsArray(ApiSubModels::validSubModelsForEndpoint(ApiEndpoint::Users));
        $this->assertIsArray(ApiSubModels::validSubModelsForEndpoint(ApiEndpoint::Event));
        $this->expectException(ImproperActionException::class);
        $this->assertIsArray(ApiSubModels::validSubModelsForEndpoint(ApiEndpoint::Info));
    }

    public function testMessages(): void
    {
        $this->assertSame(500, Messages::CriticalError->toHttpCode());
        $this->assertSame(403, Messages::InsufficientPermissions->toHttpCode());
    }

    public function testThemeVariant(): void
    {
        $this->assertSame('', ThemeVariant::Auto->toCssClass());
        $this->assertSame('', ThemeVariant::Light->toCssClass());
        $this->assertSame('dark-mode', ThemeVariant::Dark->toCssClass());
        $this->assertSame('midnight', ThemeVariant::Midnight->toCssClass());
    }

    public function testNotificationsCategoryRanges(): void
    {
        // upstream owns 15, 16 and 100 (booking approval, webhook disabled): the fork must leave them free
        foreach (array(15, 16, 100) as $upstreamValue) {
            $this->assertNull(Notifications::tryFrom($upstreamValue));
        }
        $forkValues = array(
            'TodoDeadline' => 1015, 'MentionedInTask' => 1016, 'MentionedInOrder' => 1017, 'TaskAssigned' => 1018,
            'OrderStatusChanged' => 1019, 'OrderReminder' => 1100, 'OrderChanged' => 1101, 'MentionedInFeedback' => 1102,
            'AnnouncementPublished' => 1103, 'AccessGranted' => 1104, 'MentionedInEntry' => 1105, 'StepFinished' => 1106,
            'StepAssigned' => 1107,
        );
        foreach (Notifications::cases() as $case) {
            $this->assertSame($case, Notifications::from($case->value));
            if (isset($forkValues[$case->name])) {
                $this->assertSame($forkValues[$case->name], $case->value);
            } else {
                $this->assertLessThan(1000, $case->value);
            }
        }
        $this->assertCount(count($forkValues), array_filter(Notifications::cases(), fn(Notifications $c) => $c->value >= 1000));
    }
}
