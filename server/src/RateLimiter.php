<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

/** Shared atomic PostgreSQL budgets; independent from sessions so workers/provider calls can reuse them. */
final class RateLimiter
{
    /** Bind the current database connection; no user/session side effects. */
    public function __construct(private PDO $db) {}

    /** Consume one hashed-bucket token, throwing 429 when the fixed window is exhausted. */
    public function consume(string $bucket, int $max, int $seconds, bool $httpHeaders=true): void
    {
        $q=$this->db->prepare("INSERT INTO rate_limits(bucket,hits,reset_at) VALUES (?,1,now() + make_interval(secs => ?)) ON CONFLICT(bucket) DO UPDATE SET hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END, reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING hits, GREATEST(1,ceil(extract(epoch FROM reset_at - now()))) AS retry");
        $q->execute([hash('sha256',$bucket),$seconds]);$row=$q->fetch();
        if ((int)$row['hits']>$max) {
            if ($httpHeaders) header('Retry-After: '.$row['retry']);
            throw new ApiError(429,'rate_limited','Too many requests. Try again later.');
        }
        if (random_int(1,100)===1) $this->db->exec("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'");
    }
}
