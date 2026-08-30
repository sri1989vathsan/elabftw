<?php

declare(strict_types=1);

namespace Elabftw\Services;

use Psr\Log\LoggerInterface;

final class SlowOperationTimerTest extends \PHPUnit\Framework\TestCase
{
    public function testLogsStructuredContextWhenThresholdIsReached(): void
    {
        $Logger = $this->createMock(LoggerInterface::class);
        $Logger->expects($this->once())
            ->method('warning')
            ->with(
                'custom_slow_operation',
                $this->callback(static fn(array $context): bool => $context['operation'] === 'test_operation'
                    && $context['team_id'] === 4
                    && $context['result_count'] === 12
                    && isset($context['duration_ms'])),
            );

        $Timer = new SlowOperationTimer('test_operation', $Logger, array('team_id' => 4), 0);
        $Timer->finish(12);
    }

    public function testDoesNotLogBelowThreshold(): void
    {
        $Logger = $this->createMock(LoggerInterface::class);
        $Logger->expects($this->never())->method('warning');
        $Timer = new SlowOperationTimer('fast_operation', $Logger, array(), 60_000);
        $Timer->finish();
    }
}
