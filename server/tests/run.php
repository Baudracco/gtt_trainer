<?php
declare(strict_types=1);
require dirname(__DIR__).'/vendor/autoload.php';
require __DIR__.'/fixture.php';
use GttTrainer\{ApiError, Database, Report, RouteRepository, RouteValidator};

$count = 0;
function check(bool $condition, string $message): void {
    global $count;
    if (!$condition) throw new RuntimeException('FAIL: '.$message);
    ++$count; echo 'PASS '.$message.PHP_EOL;
}
function rejects(callable $work, string $code): void {
    try { $work(); } catch (ApiError $e) {check($e->errorCode === $code, 'Reject '.$code); return;}
    throw new RuntimeException('Expected rejection: '.$code);
}
function dbReject(PDO $db, string $sql, string $label): void {
    $db->beginTransaction();
    try {$db->exec($sql);$db->exec('SET CONSTRAINTS ALL IMMEDIATE');} catch (PDOException) {$db->rollBack();check(true,$label);return;}
    $db->rollBack();throw new RuntimeException('Expected DB rejection: '.$label);
}

$base = fixture();
$valid = RouteValidator::document($base);
check($valid['geometry']['coordinates'] === $base['geometry']['coordinates'], 'Fixed geometry preserved exactly');
foreach ([[181,45],[7,91],[NAN,45],[INF,45],[7]] as $point) rejects(fn()=>RouteValidator::coordinate($point),'validation_failed');
rejects(fn()=>RouteValidator::document(array_replace_recursive($base,['stops'=>[['exchangeDirection'=>null]]])),'validation_failed');
$invalid = $base; $invalid['instructions'][1]['offsetM'] = -1; rejects(fn()=>RouteValidator::document($invalid),'validation_failed');
$invalid = $base; $invalid['instructions'][0]['offsetM'] = 600; rejects(fn()=>RouteValidator::document($invalid),'validation_failed');
$invalid = $base; $invalid['source']['url'] = 'javascript:alert(1)'; rejects(fn()=>RouteValidator::document($invalid),'validation_failed');
$repeat = $base; $repeat['stops'][] = array_replace($repeat['stops'][0],['offsetM'=>500,'exchange'=>false,'exchangeDirection'=>null]);
check(count(RouteValidator::document($repeat)['stops']) === 2, 'Repeated stop membership is retained');
$inbound = $base; $inbound['direction'] = 'ritorno'; $inbound['stops'][0]['exchange'] = false;
check(RouteValidator::document($inbound)['stops'][0]['exchange'] === false, 'Exchange metadata belongs to membership, not global stop');
$reportRoute = array_merge($valid,['id'=>Database::uuid(),'revisionId'=>Database::uuid(),'revision'=>1,'status'=>'draft']);
$reportRoute['notes'] = '<script>alert(1)</script>';
$html = Report::html($reportRoute,'it');
check(!str_contains($html,'<script>') && str_contains($html,'&lt;script&gt;'), 'Report escapes user content');
check(str_contains($html,$reportRoute['revisionId']), 'Report identifies exact revision');
$pdf = Report::pdf($html);
check(str_starts_with($pdf,'%PDF-'), 'Server produces a real PDF');
if (getenv('REPORT_TEST_PATH')) file_put_contents(getenv('REPORT_TEST_PATH'),$pdf);

if (getenv('TEST_DATABASE_DSN')) {
    putenv('DATABASE_DSN='.getenv('TEST_DATABASE_DSN'));
    $db = Database::connect();
    Database::migrate($db,dirname(__DIR__).'/migrations');
    Database::migrate($db,dirname(__DIR__).'/migrations');
    check((int)$db->query('SELECT count(*) FROM schema_migrations')->fetchColumn() === 3, 'Migrations are idempotent');
    $actor = Database::uuid();
    $db->prepare("INSERT INTO users(id,email,password_hash,role) VALUES (?,?,?,'admin')")->execute([$actor,$actor.'@test.invalid',password_hash('test-password-only',PASSWORD_ARGON2ID)]);
    $repo = new RouteRepository($db);
    $route = $repo->create($valid,$actor);
    check($route['status'] === 'draft' && $repo->list(false) === [], 'Drafts are private to editors');
    $review = $repo->transition($route['id'],1,$route['revisionId'],'review',$actor);
    $published = $repo->transition($route['id'],$review['version'],$review['revisionId'],'publish',$actor);
    check($published['status'] === 'published' && count($repo->list(false)) === 1, 'Reviewed publication becomes visible');
    $rid = $published['revisionId'];
    dbReject($db,"UPDATE route_revisions SET document = '{}' WHERE id = '$rid'",'Published document cannot change');
    dbReject($db,"UPDATE route_revisions SET created_at = now() WHERE id = '$rid'",'Published provenance cannot change');
    dbReject($db,"UPDATE route_stops SET notes = 'mutated' WHERE revision_id = '$rid'",'Published stop membership cannot change');
    dbReject($db,"DELETE FROM route_instructions WHERE revision_id = '$rid'",'Published instruction cannot be removed');
    dbReject($db,"UPDATE route_revisions SET status = 'archived' WHERE id = '$rid'",'Current pointer cannot reference an archived revision');
    $changed = $valid; $changed['notes'] = 'A new draft'; $changed['stops'][0]['name'] = 'Updated registry name';
    $draft = $repo->save($route['id'],$published['version'],$changed,$actor);
    check($draft['revision'] === 2 && $draft['status'] === 'draft', 'Save creates the next full revision');
    check($repo->get($route['id'],false)['notes'] === $valid['notes'], 'Draft edits cannot affect current publication');
    check($repo->get($route['id'],false)['stops'][0]['name'] === 'Shared test stop', 'Published stop snapshots survive registry edits');
    rejects(fn()=>$repo->save($route['id'],$published['version'],$changed,$actor),'version_conflict');
    $second = $repo->transition($route['id'],$draft['version'],$draft['revisionId'],'review',$actor);
    $second = $repo->transition($route['id'],$second['version'],$second['revisionId'],'publish',$actor);
    check($repo->get($route['id'],false)['revisionId'] === $second['revisionId'], 'Republishing atomically replaces the publication pointer');
    $restored = $repo->revert($route['id'],$second['version'],$rid,$actor);
    check($restored['revision'] === 3 && $restored['notes'] === $valid['notes'], 'Revert creates a new draft and retains history');
    rejects(fn()=>$repo->get($route['id'],false,$rid),'not_found');
    $other = $valid; $other['line'] .= '-2'; $other['stops'][0]['id'] = Database::uuid(); $other['stops'][0]['exchange'] = false;
    $shared = $repo->create($other,$actor);
    check($shared['stops'][0]['id'] === $valid['stops'][0]['id'], 'Same external stop code reuses one canonical identity');
    check($shared['stops'][0]['exchange'] === false, 'Exchange state does not leak to another line');
    $before = (int)$db->query('SELECT count(*) FROM route_variants')->fetchColumn();
    $bad = $valid; $bad['stops'][0]['code'] = 'DIFFERENT-CODE';
    rejects(fn()=>$repo->createMany([$valid,$bad],$actor),'stop_conflict');
    check((int)$db->query('SELECT count(*) FROM route_variants')->fetchColumn() === $before, 'Batch failure rolls back all imported variants');
    $repo->trash($route['id'],$restored['version'],false,$actor);
    rejects(fn()=>$repo->get($route['id'],false),'not_found');
    $trashed = $repo->get($route['id'],true);
    $repo->trash($route['id'],$trashed['version'],true,$actor);
    check($repo->get($route['id'],false)['revisionId'] === $second['revisionId'], 'Restoration preserves the last publication');
    dbReject($db,"DELETE FROM audit_events",'Audit trail is append-only');
    check(count($repo->history($route['id'])) === 3,'All saved revisions remain in history');
    require __DIR__.'/gtfs.php';
} else echo "SKIP PostGIS integration: TEST_DATABASE_DSN is unset.\n";
echo "$count checks passed.\n";
