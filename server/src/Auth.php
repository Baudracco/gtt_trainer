<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

final class Auth
{
    public function __construct(private PDO $db)
    {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('gtt_session');
        session_set_cookie_params([
            'lifetime' => 0, 'path' => '/api/', 'httponly' => true, 'samesite' => 'Strict',
            'secure' => getenv('APP_ENV') !== 'development',
        ]);
        session_start();
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    }

    public function user(): ?array
    {
        if (!isset($_SESSION['user_id'])) return null;
        if (time() - ($_SESSION['login_at'] ?? 0) > 86400 || time() - ($_SESSION['activity_at'] ?? 0) > 7200) {
            $this->clear();
            return null;
        }
        $q = $this->db->prepare('SELECT id, email, role FROM users WHERE id = ? AND enabled = true');
        $q->execute([$_SESSION['user_id']]);
        $user = $q->fetch();
        if (!$user) { $this->clear(); return null; }
        $_SESSION['activity_at'] = time();
        return $user;
    }

    public function requireRole(string $role = 'editor'): array
    {
        $user = $this->user();
        if (!$user) throw new ApiError(401, 'authentication_required', 'Please sign in.');
        $roles = ['viewer' => 0, 'editor' => 1, 'admin' => 2];
        if ($roles[$user['role']] < $roles[$role]) throw new ApiError(403, 'permission_denied', 'Insufficient permission.');
        return $user;
    }

    public function csrf(): string { return $_SESSION['csrf']; }

    public function verifyCsrf(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        if ($origin !== null && $origin !== (getenv('APP_ORIGIN') ?: 'http://localhost:5173')) throw new ApiError(403, 'csrf_failed', 'Invalid request origin.');
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($token) || !hash_equals($this->csrf(), $token)) throw new ApiError(403, 'csrf_failed', 'Invalid CSRF token.');
    }

    public function login(array $body): array
    {
        $email = strtolower(trim(is_string($body['email'] ?? null) ? $body['email'] : ''));
        $password = $body['password'] ?? '';
        if (!is_string($password) || strlen($password) > 1024 || strlen($email) > 320) throw new ApiError(401, 'invalid_credentials', 'Invalid credentials.');
        $this->limit('login-ip:'.($_SERVER['REMOTE_ADDR'] ?? ''), 20, 900);
        $this->limit('login-account:'.$email, 10, 900);
        $q = $this->db->prepare('SELECT * FROM users WHERE email = ? AND enabled = true');
        $q->execute([$email]);
        $row = $q->fetch();
        // A real Argon2id dummy hash avoids a fast path for unknown email addresses.
        $dummy = '$argon2id$v=19$m=65536,t=4,p=1$bElaem8uQVdaSzFicGRqRA$svJoQw/TGZHVBNK6BlS0dxYXjVhk6+dXQKrzcLS8eLY';
        $valid = password_verify($password, $row['password_hash'] ?? $dummy);
        if (!$valid || !$row) throw new ApiError(401, 'invalid_credentials', 'Invalid credentials.');
        session_regenerate_id(true);
        $_SESSION = ['user_id' => $row['id'], 'login_at' => time(), 'activity_at' => time(), 'csrf' => bin2hex(random_bytes(32))];
        (new RouteRepository($this->db))->audit($row['id'], 'auth.login');
        return $this->user();
    }

    public function logout(): void
    {
        $user = $this->user();
        if ($user) (new RouteRepository($this->db))->audit($user['id'], 'auth.logout');
        $this->clear();
    }

    private function clear(): void
    {
        $_SESSION = ['csrf' => bin2hex(random_bytes(32))];
        session_regenerate_id(true);
    }

    public function limit(string $bucket, int $max, int $seconds): void
    {
        $q = $this->db->prepare("INSERT INTO rate_limits(bucket,hits,reset_at) VALUES (?,1,now() + make_interval(secs => ?)) ON CONFLICT(bucket) DO UPDATE SET hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END, reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING hits, GREATEST(1,ceil(extract(epoch FROM reset_at - now()))) AS retry");
        $q->execute([hash('sha256', $bucket), $seconds]);
        $row = $q->fetch();
        if ((int) $row['hits'] > $max) {
            header('Retry-After: '.$row['retry']);
            throw new ApiError(429, 'rate_limited', 'Too many requests. Try again later.');
        }
        if (random_int(1, 100) === 1) $this->db->exec("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'");
    }
}
