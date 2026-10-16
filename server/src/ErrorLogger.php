<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;
use PDOException;
use Throwable;

/**
 * Redundant sanitized diagnostics in PostgreSQL, a locked NDJSON file and PHP's native log.
 *
 * Inspired by Shortener's documented DB/file/critical fallback architecture. Each
 * sink is independent: a failed DB or file never prevents the native record and
 * never recursively calls this logger. Business audit events remain transactional
 * and separate. Error messages/request bodies/SQL parameters/device positions are
 * deliberately absent from this schema.
 */
final class ErrorLogger
{
    /**
     * Record an unexpected failure without throwing a second failure to the client.
     *
     * A connection inside a transaction is skipped: its log row could be rolled
     * back or its transaction could already be aborted. No new DB connection is
     * opened on the exception path. The optional file path is trusted deployment
     * configuration and must point outside the public web directory.
     *
     * @return array{database:bool,file:bool,native:bool} Sink results for operations/tests.
     */
    public static function record(Throwable $error, string $trace, ?PDO $db=null, ?string $fallback=null): array
    {
        $code=$error instanceof ApiError?$error->errorCode:'internal_error';
        $state=$error instanceof PDOException && preg_match('/^[A-Z0-9]{5}$/D',(string)$error->getCode())?(string)$error->getCode():'unexpected';
        $entry=['timestamp'=>gmdate(DATE_ATOM),'trace_id'=>$trace,'code'=>$code,'number'=>ErrorCatalog::number($code),
            'type'=>$error::class,'state'=>$state,'file'=>basename($error->getFile()),'line'=>$error->getLine()];
        $result=['database'=>false,'file'=>false,'native'=>false];
        // Replacement of malformed UTF-8 makes even the failure reporter encodable.
        $json=json_encode($entry,JSON_INVALID_UTF8_SUBSTITUTE|JSON_UNESCAPED_UNICODE);
        $result['native']=error_log($json);
        if ($db) {
            try {
                if (!$db->inTransaction()) {
                    $db->prepare('INSERT INTO system_logs(trace_id,error_code,error_number,exception_type,sql_state,source_file,source_line) VALUES (?,?,?,?,?,?,?)')
                        ->execute([$trace,$code,$entry['number'],$entry['type'],$state,$entry['file'],$entry['line']]);
                    $result['database']=true;
                }
            } catch (Throwable) { /* Native/file sinks remain independent of database availability. */ }
        }
        $path=$fallback ?? (getenv('AUDIT_FALLBACK_LOG') ?: dirname(__DIR__).'/var/errors.ndjson');
        if ($path!=='') {
            try {$result['file']=FileLock::append($path,$json);} catch (Throwable) { /* Do not recurse. */ }
        }
        return $result;
    }
}
