<?php
declare(strict_types=1);
namespace GttTrainer;

/** Read-only measurements of the stored LineString. Never snaps, routes or reorders vertices. */
final class FixedGeometry
{
    /** @return array{coordinate: array, bearing: float, length: float, offsetM: float} */
    public static function at(array $coordinates, float $offset): array
    {
        $length=0.0;$position=$coordinates[0];$heading=0.0;$found=false;
        foreach ($coordinates as $i=>$b) {
            if ($i===0) continue;
            $a=$coordinates[$i-1];$segment=RouteValidator::distance($a,$b);
            if (!$found && $segment>0 && $length+$segment>=$offset) {
                $t=max(0,min(1,($offset-$length)/$segment));
                $position=[$a[0]+($b[0]-$a[0])*$t,$a[1]+($b[1]-$a[1])*$t];
                $heading=self::bearing($a,$b);$found=true;
            }
            $length+=$segment;
        }
        if (!$found) {$position=end($coordinates);$heading=self::bearing($coordinates[count($coordinates)-2],$position);}
        return ['coordinate'=>$position,'bearing'=>$heading,'length'=>$length,'offsetM'=>max(0,min($length,$offset))];
    }

    /** Compass heading in degrees clockwise from north, for an already stored segment. */
    public static function bearing(array $a, array $b): float
    {
        $d=deg2rad($b[0]-$a[0]);$lat1=deg2rad($a[1]);$lat2=deg2rad($b[1]);
        return fmod(rad2deg(atan2(sin($d)*cos($lat2),cos($lat1)*sin($lat2)-sin($lat1)*cos($lat2)*cos($d)))+360,360);
    }

    /** Signed heading difference in [-180,180); shared by imagery direction filtering. */
    public static function angle(float $a, float $b): float {return fmod($b-$a+540,360)-180;}
}
