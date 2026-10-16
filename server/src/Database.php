<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

/**
 * PostgreSQL/PostGIS connection factory, UUID generation and checksum-protected migrations.
 *
 * Migrations run under one transaction/advisory lock; applied files must never be edited.
 */
final class Database
{
    /**
     * Connect with exception errors, associative rows and native prepared statements.
     * @return PDO Reads DATABASE_DSN, DATABASE_USER and DATABASE_PASSWORD from the environment.
     */
    public static function connect(): PDO
    {
        $dsn = getenv('DATABASE_DSN') ?: 'pgsql:host=127.0.0.1;port=5432;dbname=gtt_trainer';
        return new PDO($dsn, getenv('DATABASE_USER') ?: 'gtt_trainer', getenv('DATABASE_PASSWORD') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }

    /**
     * Generate an RFC 4122 version-4 identifier using cryptographic random bytes.
     */
    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);
    }

    /**
     * Apply new SQL files in filename order under a shared migration lock.
     * @throws \RuntimeException If an already applied migration has a different checksum.
     */
    public static function migrate(PDO $db, string $directory): void
    {
        $db->beginTransaction();
        try {
            $db->exec("SELECT pg_advisory_xact_lock(18273491)");
            $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
            foreach (glob($directory.'/*.sql') ?: [] as $path) {
                $name = basename($path);
                $sql = file_get_contents($path);
                $checksum = hash('sha256', $sql);
                $q = $db->prepare('SELECT checksum FROM schema_migrations WHERE name = ?');
                $q->execute([$name]);
                $existing = $q->fetchColumn();
                if ($existing !== false) {
                    if (!hash_equals($existing, $checksum)) throw new \RuntimeException('Applied migration changed: '.$name);
                    continue;
                }
                // Adopt the foundation schema on databases initialized by the old Docker entrypoint.
                if ($name !== '001_initial.sql' || $db->query("SELECT to_regclass('public.route_variants')")->fetchColumn() === null) {
                    $db->exec($sql);
                }
                $db->prepare('INSERT INTO schema_migrations(name, checksum) VALUES (?, ?)')->execute([$name, $checksum]);
            }
            $db->commit();
        } catch (\Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
}
