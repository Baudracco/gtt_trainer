<?php
declare(strict_types=1);
namespace GttTrainer;

/**
 * Expected public API failure with a safe message, HTTP status and stable machine code.
 *
 * Unexpected Throwable messages must never be returned to clients; see ErrorCatalog.
 */
final class ApiError extends \RuntimeException
{
    /**
     * Describe an expected failure; the message must be safe to expose verbatim.
     * @param int $status HTTP failure status.
     * @param string $errorCode A code declared in ErrorCatalog.
     * @param string $message Safe user-facing detail, without SQL, paths or secrets.
     */
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }
}
