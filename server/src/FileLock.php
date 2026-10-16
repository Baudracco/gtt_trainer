<?php
declare(strict_types=1);
namespace GttTrainer;

/**
 * Bounded local-file locking and complete byte writes for diagnostic records.
 *
 * Implements the bounded-lock design pattern used in the user's Shortener project.
 * This GTT implementation uses standard PHP flock, a monotonic clock and complete
 * byte writes. The default 250 ms lock wait bounds diagnostic contention.
 *
 * @see docs/SHORTENER_REUSE.md
 */
final class FileLock
{
    /**
     * Acquire a nonblocking advisory lock, polling only until the monotonic deadline.
     *
     * @param resource $stream An already opened local regular file.
     * @param int $operation LOCK_EX or LOCK_SH; LOCK_NB is always added.
     * @param int $timeoutMs Maximum wait in milliseconds; zero means one attempt.
     * @return bool False on timeout, invalid stream or an operating-system failure.
     */
    public static function acquire(mixed $stream, int $operation=LOCK_EX, int $timeoutMs=250): bool
    {
        if (!is_resource($stream) || $timeoutMs<0 || !in_array($operation,[LOCK_EX,LOCK_SH],true)) return false;
        $deadline=hrtime(true)+$timeoutMs*1000000;
        do {
            $wouldBlock=0;
            if (@flock($stream,$operation|LOCK_NB,$wouldBlock)) return true;
            $remaining=$deadline-hrtime(true);
            if (!$wouldBlock || $remaining<=0) return false;
            usleep((int)min(10000,max(1,ceil($remaining/1000))));
        } while (true);
    }

    /**
     * Append exactly one record while holding an exclusive lock, handling short writes.
     *
     * The configured parent directory must already exist. No recursive error logging
     * occurs here: failure returns false and the caller still has the native logger.
     * A newly created file is private to its OS owner. UTF-8 length is measured in bytes.
     */
    public static function append(string $path, string $record, int $timeoutMs=250): bool
    {
        $exists=is_file($path);
        $stream=@fopen($path,'ab');
        if (!$stream) return false;
        try {
            if (!$exists) @chmod($path,0600);
            if (!self::acquire($stream,LOCK_EX,$timeoutMs)) return false;
            try {
                $bytes=rtrim($record,"\r\n")."\n";$written=0;$length=strlen($bytes);
                while ($written<$length) {
                    $count=@fwrite($stream,substr($bytes,$written));
                    if (!$count) return false;
                    $written+=$count;
                }
                return fflush($stream);
            } finally {flock($stream,LOCK_UN);}
        } finally {fclose($stream);}
    }
}
