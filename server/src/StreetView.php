<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

/**
 * Public Panoramax/STAC imagery lookup for a position on an authorized fixed route.
 *
 * Only route coordinates leave the server; device GPS fixes are never accepted.
 * Metadata is cached by geographic cell and shared across revisions. Provider photos
 * cannot change the route, advance its progress or choose a different street.
 */
final class StreetView
{
    private ?\Closure $fetch;

    /** Optional transport injection allows deterministic integration tests without external HTTP. */
    public function __construct(private PDO $db, ?callable $fetch=null)
    {
        $this->fetch=$fetch ? \Closure::fromCallable($fetch) : null;
    }

    /** Return nearby contextual photos plus the exact route position/bearing, including coverage gaps. */
    public function lookup(array $route, float $offset): array
    {
        $point=FixedGeometry::at($route['geometry']['coordinates'],$offset);
        if ($offset<0 || $offset>$point['length']+1) throw new ApiError(422,'validation_failed','Street-view offset lies outside the fixed route.');
        [$lon,$lat]=$point['coordinate'];
        $latCell=(int)floor($lat*500);$centerLat=($latCell+.5)/500;$cos=max(.01,cos(deg2rad($centerLat)));
        $lonCell=(int)floor($lon*$cos*500);$centerLon=($lonCell+.5)/500/$cos;
        $key='panoramax:'.$latCell.':'.$lonCell;
        $q=$this->db->prepare('SELECT body, expires_at > now() AS fresh FROM streetview_cache WHERE cache_key = ?');
        $q->execute([$key]);$cached=$q->fetch();
        if ($cached && $cached['fresh']) $body=json_decode($cached['body'],true,128,JSON_THROW_ON_ERROR);
        else {
            $lock=$this->db->prepare('SELECT pg_try_advisory_lock(hashtext(?))');$lock->execute([$key]);
            if (!$lock->fetchColumn()) return [...$point,'provider'=>'panoramax','status'=>'loading','photos'=>[]];
            try {
                // The second cache read prevents a queued caller repeating a completed lookup.
                $q->execute([$key]);$latest=$q->fetch();
                if ($latest && $latest['fresh']) $body=json_decode($latest['body'],true,128,JSON_THROW_ON_ERROR);
                else {
                    try {
                        (new RateLimiter($this->db))->consume('provider:panoramax',300,3600,false);
                        $bbox=[$centerLon-.002/$cos,$centerLat-.002,$centerLon+.002/$cos,$centerLat+.002];
                        $url='https://api.panoramax.xyz/api/search?'.http_build_query(['bbox'=>implode(',',$bbox),'limit'=>100,
                            'fields'=>'id,collection,geometry,assets,providers,links,properties.datetime,properties.license,properties.view:azimuth,properties.pers:interior_orientation']);
                        $raw=$this->fetch ? ($this->fetch)($url) : self::request($url);
                        $photos=self::normalize($raw['features'] ?? []);
                        $body=['status'=>'ready','photos'=>$photos,'checkedAt'=>gmdate(DATE_ATOM)];$ttl=604800;
                    } catch (\Throwable $error) {
                        $body=['status'=>$error instanceof ApiError && $error->status===429?'rate_limited':'unavailable','photos'=>[],'checkedAt'=>gmdate(DATE_ATOM)];$ttl=300;
                        if ($cached) {$old=json_decode($cached['body'],true);if(!empty($old['photos'])){$body['photos']=$old['photos'];$body['stale']=true;}}
                    }
                    $this->db->prepare('INSERT INTO streetview_cache(cache_key,body,expires_at) VALUES (?,?::jsonb,now()+(?::int*interval \'1 second\')) ON CONFLICT(cache_key) DO UPDATE SET body=EXCLUDED.body, expires_at=EXCLUDED.expires_at, checked_at=now()')
                        ->execute([$key,json_encode($body,JSON_THROW_ON_ERROR),$ttl]);
                }
            } finally {$this->db->prepare('SELECT pg_advisory_unlock(hashtext(?))')->execute([$key]);}
        }
        $photos=[];
        foreach ($body['photos'] as $photo) {
            $distance=RouteValidator::distance($point['coordinate'],$photo['coordinates']);
            // A contextual picture across the street may be useful; distant frames
            // or plane photos facing the other way must not masquerade as this view.
            if ($distance>60 || (!$photo['panorama'] && $photo['heading']!==null && abs(FixedGeometry::angle($point['bearing'],$photo['heading']))>90)) continue;
            $photo['distanceM']=round($distance,1);$photos[]=$photo;
        }
        usort($photos,static fn($a,$b)=>$a['distanceM']<=>$b['distanceM']);
        return [...$point,'provider'=>'panoramax','status'=>$photos?'available':($body['status']==='ready'?'empty':$body['status']),
            'photos'=>array_slice($photos,0,12),'checkedAt'=>$body['checkedAt'],'stale'=>$body['stale'] ?? false];
    }

    /** Whitelist factual STAC fields; ignore generated descriptions, EXIF and all provider HTML. */
    public static function normalize(array $features): array
    {
        $photos=[];
        foreach (array_slice($features,0,200) as $feature) {
            if (!is_array($feature) || ($feature['geometry']['type'] ?? '')!=='Point') continue;
            try {$coordinate=RouteValidator::coordinate(array_slice($feature['geometry']['coordinates'],0,2));} catch (\Throwable) {continue;}
            $properties=$feature['properties'] ?? [];$assets=$feature['assets'] ?? [];
            if (!is_array($properties) || !is_array($assets)) continue;
            $url=self::https($assets['sd']['href'] ?? $assets['hd']['href'] ?? '');
            if (!$url || !in_array($assets['sd']['type'] ?? $assets['hd']['type'] ?? '',['image/jpeg','image/webp','image/png'],true)) continue;
            $license=mb_substr((string)($properties['license'] ?? ''),0,100);if($license==='')continue;
            $licenseUrl='';foreach ($feature['links'] ?? [] as $link) if (($link['rel'] ?? '')==='license') $licenseUrl=self::https($link['href'] ?? '') ?: '';
            $id=(string)($feature['id'] ?? '');$collection=(string)($feature['collection'] ?? '');
            if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id) || !preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$collection)) continue;
            $interior=$properties['pers:interior_orientation'] ?? [];
            if (!is_array($interior)) $interior=[];
            $projection=strtolower((string)($interior['camera_type'] ?? $interior['projection_type'] ?? ''));
            $fov=$interior['field_of_view'] ?? 0;$fov=is_array($fov)?($fov[0] ?? 0):$fov;
            $panorama=in_array($projection,['spherical','equirectangular','panorama'],true) || (is_numeric($fov) && is_finite((float)$fov) && (float)$fov>=359);
            $azimuth=$properties['view:azimuth'] ?? null;
            $heading=is_numeric($azimuth) && is_finite((float)$azimuth)?fmod(fmod((float)$azimuth,360)+360,360):null;
            $providers=is_array($feature['providers'] ?? null)?$feature['providers']:[];
            $credit=implode(' · ',array_unique(array_filter(array_map(static fn($p)=>is_array($p)?mb_substr((string)($p['name'] ?? ''),0,200):'',$providers))));
            $photos[]=['id'=>$id,'collection'=>$collection,'url'=>$url,'thumbnailUrl'=>self::https($assets['thumb']['href'] ?? '') ?: $url,
                'coordinates'=>$coordinate,'heading'=>$heading,'panorama'=>$panorama,'capturedAt'=>mb_substr((string)($properties['datetime'] ?? ''),0,80),
                'credit'=>mb_substr($credit,0,500),'license'=>$license,'licenseUrl'=>$licenseUrl,
                'sourceUrl'=>'https://api.panoramax.xyz/?'.http_build_query(['focus'=>'pic','pic'=>$id,'seq'=>$collection])];
        }
        return $photos;
    }

    /** Fetch only the fixed official HTTPS API endpoint; redirects and unbounded bodies are refused. */
    private static function request(string $url): array
    {
        $context=stream_context_create(['http'=>['timeout'=>10,'follow_location'=>0,'header'=>"Accept: application/geo+json\r\nUser-Agent: GTT-Trainer/0.4\r\n"]]);
        $stream=@fopen($url,'rb',false,$context);
        if (!$stream) throw new \RuntimeException('Street imagery provider unavailable.');
        try {$bytes=stream_get_contents($stream,4194305);} finally {fclose($stream);}
        if (strlen($bytes)>4194304) throw new \RuntimeException('Street imagery response exceeds limits.');
        $result=json_decode($bytes,true,128,JSON_THROW_ON_ERROR);
        if (!is_array($result) || !is_array($result['features'] ?? null)) throw new \RuntimeException('Invalid STAC response.');
        return $result;
    }

    /** External links are data, never HTML/scripts, credentials or local file paths. */
    private static function https(mixed $value): ?string
    {
        if (!is_string($value) || strlen($value)>2000 || !filter_var($value,FILTER_VALIDATE_URL)) return null;
        $parts=parse_url($value);
        return ($parts['scheme'] ?? '')==='https' && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) ? $value : null;
    }
}
