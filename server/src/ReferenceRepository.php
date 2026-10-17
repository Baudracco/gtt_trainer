<?php
declare(strict_types=1);
namespace GttTrainer;

/** Read private imported operational references after the API verifies an enabled account.
 * No original PDF, literal source facts or photos are packaged in the public web root.
 * Immutable parts are addressed by checksum; importing switches the small index last.
 */
final class ReferenceRepository
{
    /** Resolve private runtime storage, with an override for isolated tests/deployments. */
    public static function directory(): string
    {
        return getenv('REFERENCE_DIR') ?: dirname(__DIR__).'/var/references';
    }

    /** Return an explicit empty state on new installations, without sample operational data. */
    public function index(): array
    {
        $path=self::directory().'/index.json';
        return is_file($path) ? $this->read($path,262144) : ['available'=>false];
    }

    /** Read one bounded immutable movement or source-block part and verify its bytes. */
    public function part(string $kind, string $hash): array
    {
        if (!in_array($kind,['parts','blocks'],true) || !preg_match('/^[a-f0-9]{64}$/D',$hash)) throw new ApiError(404,'not_found','Reference not found.');
        return $this->read(self::directory().'/'.$kind.'/'.$hash.'.json',$kind==='parts'?131072:2097152,$hash);
    }

    /** Return locally imported change-post facts, or an explicit empty installation state. */
    public function changes(): array
    {
        $path=self::directory().'/changes.json';
        return is_file($path) ? $this->read($path,262144) : ['posts'=>[]];
    }

    private function read(string $path,int $limit,?string $hash=null): array
    {
        if (!is_file($path) || is_link($path)) throw new ApiError(404,'not_found','Reference not found.');
        $raw=file_get_contents($path,false,null,0,$limit+1);
        if ($raw===false || strlen($raw)>$limit || ($hash!==null && !hash_equals($hash,hash('sha256',$raw)))) throw new \RuntimeException('Reference integrity check failed.');
        $value=json_decode($raw,true,128,JSON_THROW_ON_ERROR);
        if (!is_array($value)) throw new \RuntimeException('Invalid private reference document.');
        return $value;
    }
}
