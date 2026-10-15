<?php
declare(strict_types=1);
require dirname(__DIR__).'/vendor/autoload.php';
use GttTrainer\{Database, RouteRepository, RouteValidator};

try {
    $db = Database::connect();
    $command = $argv[1] ?? '';
    if ($command === 'migrate') {
        Database::migrate($db, dirname(__DIR__).'/migrations');
        echo "Migrations applied.\n";
    } elseif ($command === 'user:create') {
        $email = strtolower($argv[2] ?? ''); $role = $argv[3] ?? 'viewer';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($role, ['viewer','editor','admin'], true)) throw new RuntimeException('Usage: user:create email viewer|editor|admin (password from stdin)');
        // Avoid process arguments and shell history for passwords.
        if (function_exists('stream_isatty') && stream_isatty(STDIN)) throw new RuntimeException('Pipe a password to stdin from a secret prompt or password manager.');
        $password = rtrim(stream_get_contents(STDIN, 1026), "\r\n");
        if (strlen($password) < 12 || strlen($password) > 1024) throw new RuntimeException('Password must be 12–1024 bytes.');
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $db->prepare('INSERT INTO users(email,password_hash,role) VALUES (?,?,?)')->execute([$email,$hash,$role]);
        echo "User created.\n";
    } elseif ($command === 'import') {
        $path = $argv[2] ?? ''; $email = strtolower($argv[3] ?? '');
        $q = $db->prepare("SELECT id FROM users WHERE email = ? AND enabled AND role IN ('editor','admin')"); $q->execute([$email]);
        $actor = $q->fetchColumn();
        if (!$actor || !is_file($path) || filesize($path) > 16777216) throw new RuntimeException('Usage: import route-document.json editor-email (max 16 MiB)');
        $documents = json_decode(file_get_contents($path), true, 128, JSON_THROW_ON_ERROR);
        if (!array_is_list($documents)) $documents = [$documents];
        $repo = new RouteRepository($db);
        $validated = array_map(RouteValidator::document(...), $documents);
        foreach ($repo->createMany($validated, $actor) as $route) {
            echo $route['id']." draft\n";
        }
    } else {
        echo "Commands: migrate | user:create EMAIL ROLE < password | import FILE EDITOR_EMAIL\n";
        exit(1);
    }
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
