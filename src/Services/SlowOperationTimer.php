<?php

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Elabftw\App;
use Elabftw\Elabftw\Env;
use Psr\Log\LoggerInterface;

use function microtime;

/** Log only slow custom operations, without recording document or search contents. */
final class SlowOperationTimer
{
    private float $startedAt;

    /** @param array<string, int|string|bool> $context */
    public function __construct(
        private readonly string $operation,
        private readonly LoggerInterface $logger,
        private readonly array $context = array(),
        private readonly int $thresholdMs = 500,
    ) {
        $this->startedAt = microtime(true);
    }

    /** @param array<string, int|string|bool> $context */
    public static function start(string $operation, array $context = array()): self
    {
        $configured = Env::asInt('CUSTOM_SLOW_OPERATION_MS');
        return new self($operation, App::getDefaultLogger(), $context, $configured > 0 ? $configured : 500);
    }

    public function finish(int $resultCount = 0): int
    {
        $durationMs = (int) ((microtime(true) - $this->startedAt) * 1000);
        if ($durationMs >= $this->thresholdMs) {
            $this->logger->warning('custom_slow_operation', $this->context + array(
                'operation' => $this->operation,
                'duration_ms' => $durationMs,
                'result_count' => $resultCount,
            ));
        }
        return $durationMs;
    }
}
