<?php
declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use GttTrainer\{ApiError, Auth, Database, ErrorCatalog, ErrorLogger, GtfsSynchronizer, MediaRepository, Report, RouteRepository, RouteValidator, StreetView};

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
    if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY)) throw new ApiError(422,'validation_failed','Use path parameters; this API does not accept query parameters.');
    if ($path === '/api/v1/health' && $method === 'GET') respond(['status' => 'ok', 'version' => '0.4.0']);
    $db = Database::connect();
    $auth = new Auth($db);
    $auth->limit('request:'.($_SERVER['REMOTE_ADDR'] ?? ''), 240, 60);
    $repo = new RouteRepository($db);
    $user = $auth->user();
    $editor = $user && in_array($user['role'], ['editor','admin'], true);
    if (!in_array($method,['GET','HEAD'],true)) $auth->verifyCsrf();
    if ($path === '/api/v1/session' && $method === 'GET') respond(['user' => $user, 'csrf' => $auth->csrf()]);
    if ($path === '/api/v1/login' && $method === 'POST') respond(['user' => $auth->login(body()), 'csrf' => $auth->csrf()]);
    if ($path === '/api/v1/logout' && $method === 'POST') { body(); $auth->logout(); respond(['user' => null, 'csrf' => $auth->csrf()]); }
    if ($path === '/api/v1/stops' && $method === 'GET') { $auth->requireRole(); respond($repo->stops()); }
    if (in_array($path,['/api/v1/media/photos','/api/v1/media/videos'],true) && $method === 'POST') {
        $actor=$auth->requireRole();
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''),'multipart/form-data;')) throw new ApiError(415,'unsupported_media_type','Send multipart/form-data.');
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>MediaRepository::VIDEO_LIMIT+1048576) throw new ApiError(413,'media_too_large','File exceeds the upload limit.');
        $postLimit=ini_parse_quantity(ini_get('post_max_size'));
        if ($postLimit>0 && (int)($_SERVER['CONTENT_LENGTH'] ?? 0)>$postLimit) throw new ApiError(413,'media_too_large','File exceeds the PHP upload limit.');
        if (count($_FILES)!==1 || !is_array($_FILES['file'] ?? null)) throw new ApiError(422,'invalid_media','Upload exactly one file.');
        session_write_close();
        respond((new MediaRepository($db))->upload($_FILES['file'],str_ends_with($path,'photos')?'photo':'video',$actor['id']),201);
    }
    if (preg_match('~^/api/v1/media/([^/]+)$~D',$path,$match) && in_array($method,['GET','HEAD'],true)) {
        MediaRepository::serve((new MediaRepository($db))->get(RouteValidator::uuid($match[1]),(bool)$editor),$method==='HEAD');
    }
    if ($path === '/api/v1/routes/trash' && $method === 'GET') {$auth->requireRole();respond($repo->list(true,true));}
    if (preg_match('~^/api/v1/routes/([^/]+)/revisions/([^/]+)/streetview/([0-9]{1,9})$~D',$path,$match) && $method==='GET') {
        $route=$repo->get(RouteValidator::uuid($match[1]),(bool)$editor,RouteValidator::uuid($match[2]));
        session_write_close();respond((new StreetView($db))->lookup($route,(float)$match[3]));
    }
    if ($path === '/api/v1/sources/gtt' && $method === 'GET') { $auth->requireRole(); respond((new GtfsSynchronizer($db))->status()); }
    if (preg_match('~^/api/v1/sources/gtt/(gtt:[a-f0-9]{64})/document$~D', $path, $match) && $method === 'GET') {
        $auth->requireRole(); respond((new GtfsSynchronizer($db))->pending($match[1]));
    }
    if ($path === '/api/v1/imports' && $method === 'POST') {
        $actor = $auth->requireRole(); $data = body();
        if (!is_array($data['documents'] ?? null) || !array_is_list($data['documents']) || count($data['documents']) < 1 || count($data['documents']) > 200) throw new ApiError(422, 'validation_failed', 'Import requires 1–200 documents.');
        $documents = array_map(static function ($document) { if (!is_array($document)) throw new ApiError(422, 'validation_failed', 'Invalid route document.'); return RouteValidator::document($document); }, $data['documents']);
        respond($repo->createMany($documents, $actor['id']), 201);
    }
    if ($path === '/api/v1/routes') {
        if ($method === 'GET') {
            respond($repo->list((bool) $editor));
        }
        if ($method === 'POST') {
            $actor = $auth->requireRole();
            respond($repo->create(RouteValidator::document(body()), $actor['id']), 201);
        }
    }
    if (preg_match('~^/api/v1/routes/([^/]+)/revisions/([^/]+)(?:/report/([^/.]+)\.([^/.]+))?$~D',$path,$match) && $method==='GET') {
        $id=RouteValidator::uuid($match[1]);$revision=RouteValidator::uuid($match[2]);
        $route=$repo->get($id,(bool)$editor,$revision);
        if (!isset($match[3])) respond($route);
        $lang=$match[3];$format=$match[4];
        if (!in_array($lang,['es','it','en'],true) || !in_array($format,['html','pdf'],true)) throw new ApiError(422,'validation_failed','Invalid report language or format.');
        $auth->limit('report:'.($_SERVER['REMOTE_ADDR'] ?? ''),15,60);
        $html=Report::html($route,$lang,(new MediaRepository($db))->reportImages($route));
        if ($format==='pdf') {
            header('Content-Type: application/pdf');header('Content-Disposition: attachment; filename="gtt-route-'.$id.'-r'.$route['revision'].'.pdf"');echo Report::pdf($html);
        } else {header('Content-Type: text/html; charset=utf-8');echo $html;}
        exit;
    }
    if (preg_match('~^/api/v1/routes/([^/]+)(?:/(draft|review|publish|restore|history|revert))?$~D', $path, $match)) {
        $id = RouteValidator::uuid($match[1]);
        $action = $match[2] ?? '';
        if ($method === 'GET') {
            if ($action === 'history') { $auth->requireRole(); respond($repo->history($id)); }
            if ($action === '') respond($repo->get($id,(bool)$editor));
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
        ErrorLogger::record($error,$trace,$db ?? null);
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');header_remove('Content-Disposition');header_remove('Content-Length');
    echo json_encode(['error' => ['code' => $code, 'number' => ErrorCatalog::number($code), 'message' => $message], 'trace_id' => $trace], JSON_UNESCAPED_UNICODE);
}
