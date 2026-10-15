<?php
declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use GttTrainer\{ApiError, Auth, Database, Report, RouteRepository, RouteValidator};

$trace = bin2hex(random_bytes(12));
header('X-Trace-Id: '.$trace);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'");
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
if (getenv('APP_ENV') !== 'development') header('Strict-Transport-Security: max-age=31536000');

function respond(mixed $data, int $status = 200): never
{
    global $trace;
    http_response_code($status);
    echo json_encode(['data' => $data, 'trace_id' => $trace], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array
{
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') throw new ApiError(415, 'unsupported_media_type', 'Send application/json.');
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 4194304) throw new ApiError(413, 'payload_too_large', 'Request exceeds 4 MiB.');
    $raw = file_get_contents('php://input', false, null, 0, 4194305);
    if (strlen($raw) > 4194304) throw new ApiError(413, 'payload_too_large', 'Request exceeds 4 MiB.');
    try { $data = json_decode($raw, true, 128, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw new ApiError(400, 'invalid_json', 'Invalid JSON.'); }
    if (!is_array($data) || !str_starts_with(ltrim($raw), '{')) throw new ApiError(400, 'invalid_json', 'Expected a JSON object.');
    return $data;
}

function version(array $body): int
{
    if (!is_int($body['expectedVersion'] ?? null) || $body['expectedVersion'] < 1) throw new ApiError(422, 'validation_failed', 'expectedVersion is required.');
    return $body['expectedVersion'];
}

try {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $method = $_SERVER['REQUEST_METHOD'];
    if ($path === '/api/v1/health' && $method === 'GET') respond(['status' => 'ok', 'version' => '0.2.0']);
    $db = Database::connect();
    $auth = new Auth($db);
    $auth->limit('request:'.($_SERVER['REMOTE_ADDR'] ?? ''), 240, 60);
    $repo = new RouteRepository($db);
    $user = $auth->user();
    $editor = $user && in_array($user['role'], ['editor','admin'], true);
    if ($method !== 'GET') $auth->verifyCsrf();
    if ($path === '/api/v1/session' && $method === 'GET') respond(['user' => $user, 'csrf' => $auth->csrf()]);
    if ($path === '/api/v1/login' && $method === 'POST') respond(['user' => $auth->login(body()), 'csrf' => $auth->csrf()]);
    if ($path === '/api/v1/logout' && $method === 'POST') { body(); $auth->logout(); respond(['user' => null, 'csrf' => $auth->csrf()]); }
    if ($path === '/api/v1/stops' && $method === 'GET') { $auth->requireRole(); respond($repo->stops()); }
    if ($path === '/api/v1/imports' && $method === 'POST') {
        $actor = $auth->requireRole(); $data = body();
        if (!is_array($data['documents'] ?? null) || !array_is_list($data['documents']) || count($data['documents']) < 1 || count($data['documents']) > 200) throw new ApiError(422, 'validation_failed', 'Import requires 1–200 documents.');
        $documents = array_map(static function ($document) { if (!is_array($document)) throw new ApiError(422, 'validation_failed', 'Invalid route document.'); return RouteValidator::document($document); }, $data['documents']);
        respond($repo->createMany($documents, $actor['id']), 201);
    }
    if ($path === '/api/v1/routes') {
        if ($method === 'GET') {
            $trash = ($_GET['trash'] ?? '') === '1';
            if ($trash) $auth->requireRole();
            respond($repo->list((bool) $editor, $trash));
        }
        if ($method === 'POST') {
            $actor = $auth->requireRole();
            respond($repo->create(RouteValidator::document(body()), $actor['id']), 201);
        }
    }
    if (preg_match('~^/api/v1/routes/([^/]+)(?:/(draft|review|publish|restore|history|report|revert))?$~D', $path, $match)) {
        $id = RouteValidator::uuid($match[1]);
        $action = $match[2] ?? '';
        if ($method === 'GET') {
            if ($action === 'history') { $auth->requireRole(); respond($repo->history($id)); }
            if ($action === '' || $action === 'report') {
                $revision = isset($_GET['revision']) ? RouteValidator::uuid($_GET['revision']) : null;
                $route = $repo->get($id, (bool) $editor, $revision);
                if ($action === '') respond($route);
                $lang = $_GET['lang'] ?? 'es';
                if (!in_array($lang, ['es','it','en'], true)) throw new ApiError(422, 'validation_failed', 'Invalid report language.');
                $format = $_GET['format'] ?? 'html';
                if (!in_array($format, ['html','pdf'], true)) throw new ApiError(422, 'validation_failed', 'Invalid report format.');
                $auth->limit('report:'.($_SERVER['REMOTE_ADDR'] ?? ''), 15, 60);
                $html = Report::html($route, $lang);
                if ($format === 'pdf') {
                    header('Content-Type: application/pdf');
                    header('Content-Disposition: attachment; filename="gtt-route-'.$id.'-r'.$route['revision'].'.pdf"');
                    echo Report::pdf($html);
                } else { header('Content-Type: text/html; charset=utf-8'); echo $html; }
                exit;
            }
        }
        if ($method === 'PUT' && $action === 'draft') {
            $actor = $auth->requireRole(); $data = body();
            respond($repo->save($id, version($data), RouteValidator::document($data), $actor['id']));
        }
        if ($method === 'DELETE' && $action === '') {
            $actor = $auth->requireRole(); $data = body();
            $repo->trash($id, version($data), false, $actor['id']); respond(['deleted' => true]);
        }
        if ($method === 'POST' && in_array($action, ['review','publish','restore','revert'], true)) {
            $actor = $auth->requireRole($action === 'publish' ? 'admin' : 'editor'); $data = body();
            $expected = version($data);
            if ($action === 'restore') { $repo->trash($id, $expected, true, $actor['id']); respond($repo->get($id, true)); }
            $revisionId = RouteValidator::uuid($data['revisionId'] ?? null);
            if ($action === 'revert') respond($repo->revert($id, $expected, $revisionId, $actor['id']));
            if ($action === 'publish' && ($data['verified'] ?? null) !== true) throw new ApiError(422, 'publication_incomplete', 'Confirm that the fixed route and instructions were reviewed.');
            respond($repo->transition($id, $expected, $revisionId, $action, $actor['id']));
        }
    }
    throw new ApiError(404, 'not_found', 'Endpoint not found.');
} catch (Throwable $error) {
    if ($error instanceof PDOException && in_array($error->getCode(), ['23505','40001','40P01'], true)) $error = new ApiError(409, 'data_conflict', 'Concurrent data change. Reload before retrying.');
    $status = $error instanceof ApiError ? $error->status : 500;
    $code = $error instanceof ApiError ? $error->errorCode : 'internal_error';
    $message = $error instanceof ApiError ? $error->getMessage() : 'Internal server error.';
    if ($status >= 500) {
        // Do not log request bodies, passwords, cookies, location or SQL parameter values.
        $entry = json_encode(['trace_id' => $trace, 'type' => $error::class, 'state' => $error instanceof PDOException ? $error->getCode() : 'unexpected', 'file' => basename($error->getFile()), 'line' => $error->getLine()]);
        error_log($entry);
        $fallback = getenv('AUDIT_FALLBACK_LOG');
        if ($fallback) file_put_contents($fallback, $entry.PHP_EOL, FILE_APPEND | LOCK_EX);
    }
    http_response_code($status);
    echo json_encode(['error' => ['code' => $code, 'message' => $message], 'trace_id' => $trace], JSON_UNESCAPED_UNICODE);
}
