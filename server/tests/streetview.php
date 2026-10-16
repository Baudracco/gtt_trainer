<?php
// Deterministic Panoramax integration: real PostGIS cache, injected HTTP transport.
use GttTrainer\{FixedGeometry, StreetView, RouteValidator};

function streetFeature(string $id='image-1', array $position=[7.6,45.0], bool $panorama=true): array {
    return ['id'=>$id,'collection'=>'sequence-1','geometry'=>['type'=>'Point','coordinates'=>$position],
        'assets'=>['sd'=>['href'=>'https://images.example.invalid/'.$id.'.jpg','type'=>'image/jpeg']],
        'properties'=>['license'=>'CC-BY-SA-4.0','datetime'=>'2025-05-01T12:00:00Z','view:azimuth'=>90,
            'pers:interior_orientation'=>['field_of_view'=>$panorama?360:90]],
        'providers'=>[['name'=>'Test photographer']], 'links'=>[['rel'=>'license','href'=>'https://creativecommons.org/licenses/by-sa/4.0/']]];
}
$geometry=fixture();$before=$geometry['geometry'];
$point=FixedGeometry::at($before['coordinates'],100);
check(abs(RouteValidator::distance($point['coordinate'],$before['coordinates'][0])-100)<.1 && abs($point['bearing']-90)<.1, 'Virtual progress interpolates the saved path in metres');
check(FixedGeometry::at($before['coordinates'],1e9)['coordinate']===end($before['coordinates']), 'Virtual geometry clamps to the actual endpoint');
$photo=streetFeature();$normal=StreetView::normalize([$photo]);
check($normal[0]['panorama'] && $normal[0]['license']==='CC-BY-SA-4.0', 'Panoramax scalar 360-degree metadata and attribution are preserved');
$photo['properties']['semantics']='<script>invented street instruction</script>';
$photo['properties']['view:azimuth']='1e999';
check(StreetView::normalize([$photo])[0]['heading']===null && !str_contains(json_encode(StreetView::normalize([$photo])),'invented'), 'Nonfinite heading and generated descriptions never enter the viewer contract');
foreach (['javascript:alert(1)','http://example.invalid/p.jpg','https://user:pass@example.invalid/p.jpg','https://example.invalid:8080/p.jpg'] as $unsafe) {
    $bad=streetFeature();$bad['assets']['sd']['href']=$unsafe;
    check(StreetView::normalize([$bad])===[], 'Imagery rejects unsafe source URL');
}
$db->exec('DELETE FROM streetview_cache');
$calls=0;
$service=new StreetView($db,function($url) use (&$calls) {
    ++$calls;check(str_starts_with($url,'https://api.panoramax.xyz/api/search?bbox='), 'Imagery transport can contact only the fixed provider search');
    $back=streetFeature('back',[7.6001,45],false);$back['properties']['view:azimuth']=270;
    return ['features'=>[streetFeature(),streetFeature('distant',[7.62,45]),$back]];
});
$frame=$service->lookup($geometry,0);
check($frame['status']==='available' && count($frame['photos'])===1, 'Viewer excludes distant and reverse-facing plane photos');
$service->lookup($geometry,1);
check($calls===1 && $geometry['geometry']===$before, 'Nearby progress reuses shared cached metadata and never changes geometry');
rejects(fn()=>$service->lookup($geometry,-1),'validation_failed');
rejects(fn()=>$service->lookup($geometry,1e9),'validation_failed');
$db->exec("UPDATE streetview_cache SET expires_at=now()-interval '1 second'");
$failed=new StreetView($db,static fn()=>throw new RuntimeException('synthetic provider outage'));
$stale=$failed->lookup($geometry,0);
check($stale['stale'] && count($stale['photos'])===1, 'Provider outage retains previously cached nearby imagery');
$db->exec('DELETE FROM streetview_cache');
check($failed->lookup($geometry,0)['status']==='unavailable', 'Missing imagery has an explicit recoverable status');
$db->exec('DELETE FROM streetview_cache');
