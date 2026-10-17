<?php
// Required by run.php after existing PostGIS assertions. Uses its isolated DB/actor.
use GttTrainer\{Database, GtfsSynchronizer, RouteValidator};

$sync = new GtfsSynchronizer($db);
$source = fixture(); $source['line'] = 'GTFS-TEST';
$source['source']['url'] = 'https://www.gtt.to.it/open_data/gtt_gtfs.zip';
$source['stops'][0]['exchange'] = false; $source['stops'][0]['exchangeDirection'] = null;
$key = 'gtt:'.str_repeat('a',64);
$bundle = ['schemaVersion'=>1,'provider'=>'gtt','archiveSha256'=>str_repeat('1',64),'downloadedAt'=>'2026-10-16T06:00:00Z',
    'variants'=>[['key'=>$key,'route'=>'T','shape'=>'S','direction'=>'1','stopIds'=>['X'],'document'=>$source]],'rejected'=>[]];
$seed = $repo->create(RouteValidator::document($source),$actor);
$bundle['variants'][0]['projectionRecovery']=['method'=>'ordered_projection','maxDistanceM'=>12.5];
$result = $sync->apply($bundle);
check($result['adopted'] === 1 && $result['created'] === 0, 'GTFS adopts exact initial imports without duplicating variants');
check($sync->status()['projectionRecoveries'][0]['identity']['projectionRecovery']['maxDistanceM'] === 12.5, 'Source recovery evidence is retained and visible to editors');
check($sync->apply($bundle)['unchanged'] === 1, 'GTFS repeated ingestion creates no extra revisions');
$review = $repo->transition($seed['id'],$seed['version'],$seed['revisionId'],'review',$actor);
$publication = $repo->transition($seed['id'],$review['version'],$review['revisionId'],'publish',$actor);
$bundle['archiveSha256'] = str_repeat('2',64);
$bundle['variants'][0]['document']['source']['retrievedAt'] = '2026-10-17';
check($sync->apply($bundle)['unchanged'] === 1 && count($repo->history($seed['id'])) === 1, 'ZIP/date-only changes create no route revision');
$bundle['archiveSha256'] = str_repeat('3',64);
$bundle['variants'][0]['document']['geometry']['coordinates'][1][0] += .001;
check($sync->apply($bundle)['updated'] === 1, 'Changed GTFS geometry automatically creates the next candidate revision');
$candidate = $repo->get($seed['id'],true);
check($candidate['revision'] === 2 && $candidate['status'] === 'draft' && $repo->get($seed['id'],false)['revisionId'] === $publication['revisionId'], 'Automatic update preserves the published fixed route');
$manual = RouteValidator::document($candidate); $manual['notes'] = 'Manual work must survive incoming updates';
$manual = $repo->save($seed['id'],$candidate['version'],$manual,$actor);
$bundle['archiveSha256'] = str_repeat('4',64);
$bundle['variants'][0]['document']['geometry']['coordinates'][1][0] += .001;
check($sync->apply($bundle)['conflicts'] === 1, 'Manual working revision blocks automatic replacement');
check($repo->get($seed['id'],true)['revisionId'] === $manual['revisionId'], 'Manual draft remains active and intact after synchronization');
check(RouteValidator::document($sync->pending($key))['geometry'] === RouteValidator::document($bundle['variants'][0]['document'])['geometry'], 'Conflicting incoming document is retained for review/export');
$status = $sync->status();
check($status['archiveSha256'] === str_repeat('4',64) && $status['issues'][0]['state'] === 'conflict', 'Editors can inspect source hash and unresolved updates');
$saved = $bundle['variants'][0];
$bundle['variants'] = []; $bundle['rejected'] = [['key'=>$key,'reason'=>'Synthetic 400m discrepancy'],
    ['key'=>'gtt:'.str_repeat('b',64),'reason'=>'Synthetic invalid pattern']];
// Keep at least one other valid variant; a feed with zero valid candidates is rejected.
$otherSource = $source; $otherSource['name'] = 'Other source variant';
$bundle['variants'] = [['key'=>'gtt:'.str_repeat('c',64),'document'=>$otherSource]];
$result = $sync->apply($bundle);
check($result['rejected'] === 2 && $result['missing'] === 0, 'Rejected observed patterns are not mistaken for removed routes');
$bundle['rejected'] = [];
check($sync->apply($bundle)['missing'] === 2 && $repo->get($seed['id'],false)['revisionId'] === $publication['revisionId'], 'Disappearing source variants preserve local publication and history');
$bundle['variants'][] = $saved;
$manual = $repo->get($seed['id'],true); $repo->trash($seed['id'],$manual['version'],false,$actor);
check($sync->apply($bundle)['deleted'] === 1 && $repo->get($seed['id'],true)['deleted'], 'Synchronization cannot resurrect a deliberately deleted variant');
$before = count($repo->history($seed['id']));
$badBundle = $bundle; $badBundle['variants'][] = $saved;
try {$sync->apply($badBundle);throw new RuntimeException('Duplicate identity accepted');} catch (InvalidArgumentException) {}
check(count($repo->history($seed['id'])) === $before, 'Invalid sync input leaves the database unchanged');
