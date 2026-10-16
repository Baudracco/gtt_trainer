<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

/**
 * Private immutable media storage, validated uploads and revision-based access control.
 *
 * Files live outside the web root. Photos are decoded/re-encoded, videos inspected
 * with bounded ffprobe; associations are created in the revision transaction. Public
 * reads require a current nontrashed publication referencing the asset.
 */
final class MediaRepository
{
    public const PHOTO_LIMIT = 12582912; // 12 MiB input, normalized JPEG output.
    public const VIDEO_LIMIT = 1073741824; // 1 GiB; streams to disk, never into a PHP string.

    /**
     * Bind storage metadata/audit to the application database.
     */
    public function __construct(private PDO $db) {}

    /**
     * Resolve the private MEDIA_DIR override or the persistent server/var/media directory.
     */
    public static function directory(): string
    {
        return getenv('MEDIA_DIR') ?: dirname(__DIR__).'/var/media';
    }

    /**
     * Validate one genuine PHP multipart upload, write immutable files and commit metadata/audit.
     *
     * Photos: JPEG/PNG/WebP, 12 MiB, 32 MP, normalized JPEG plus PDF thumbnail.
     * Video: MP4/WebM, 1 GiB, inspected codecs/duration; never loaded into memory as a whole.
     * @throws ApiError On invalid type, corrupt media or exceeded size/codec limits.
     */
    public function upload(array $file, string $kind, string $actor): array
    {
        $limit = $kind === 'photo' ? self::PHOTO_LIMIT : self::VIDEO_LIMIT;
        $error = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new ApiError(413, 'media_too_large', 'File exceeds the upload limit.');
        if ($error !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) throw new ApiError(422, 'invalid_media', 'Select one complete file.');
        $input = $file['tmp_name']; $bytes = filesize($input);
        if ($bytes < 1 || $bytes > $limit) throw new ApiError(413, 'media_too_large', 'File exceeds the upload limit.');
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($input);
        $originalHash = hash_file('sha256', $input);
        $id = Database::uuid(); $directory = self::directory();
        if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) throw new \RuntimeException('Cannot prepare media storage.');
        $target = null; $thumb = $directory.'/'.$id.'.thumb.jpg';
        try {
            if ($kind === 'photo') {
                if (!in_array($mime, ['image/jpeg','image/png','image/webp'], true)) throw new ApiError(415, 'unsupported_media', 'Use JPEG, PNG or WebP for photos.');
                $size = @getimagesize($input);
                if (!$size || $size[0] * $size[1] > 32000000) throw new ApiError(422, 'invalid_media', 'Photo cannot be decoded or exceeds 32 megapixels.');
                $image = @imagecreatefromstring(file_get_contents($input));
                if (!$image) throw new ApiError(422, 'invalid_media', 'Photo cannot be decoded.');
                try {
                    if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
                        $orientation = (int)(@exif_read_data($input)['Orientation'] ?? 1);
                        if (in_array($orientation,[2,4,5,7],true)) imageflip($image, IMG_FLIP_HORIZONTAL);
                        $angle = match($orientation) {3,4=>180,5,6=>-90,7,8=>90,default=>0};
                        if ($angle) {$rotated=imagerotate($image,$angle,0);imagedestroy($image);$image=$rotated;}
                    }
                    $extension = 'jpg'; $mime = 'image/jpeg'; $target = $directory.'/'.$id.'.jpg';
                    self::jpeg($image,$target,2400,88);
                    self::jpeg($image,$thumb,600,78);
                    $metadata = ['width'=>imagesx($image),'height'=>imagesy($image)];
                } finally {imagedestroy($image);}
            } else {
                if (!in_array($mime, ['video/mp4','video/webm'], true)) throw new ApiError(415, 'unsupported_media', 'Use MP4/H.264 or WebM for video.');
                $metadata = self::probe($input);
                $extension = $mime === 'video/mp4' ? 'mp4' : 'webm';
                $allowed = $extension === 'mp4' ? ['h264','av1'] : ['vp8','vp9','av1'];
                if (!in_array($metadata['codec'], $allowed, true)) throw new ApiError(415, 'unsupported_media', 'Use MP4/H.264 or WebM/VP8/VP9/AV1 for browser playback.');
                $target = $directory.'/'.$id.'.'.$extension;
                if (!move_uploaded_file($input,$target)) throw new \RuntimeException('Cannot store video upload.');
            }
            chmod($target,0644); if (is_file($thumb)) chmod($thumb,0644);
            $this->db->beginTransaction();
            $this->db->prepare('INSERT INTO media_assets(id,kind,mime,extension,bytes,sha256,original_sha256,original_name,metadata,created_by) VALUES (?,?,?,?,?,?,?,?,?::jsonb,?)')
                ->execute([$id,$kind,$mime,$extension,filesize($target),hash_file('sha256',$target),$originalHash,
                    mb_substr(basename((string)($file['name'] ?? 'upload')),0,200),json_encode($metadata,JSON_THROW_ON_ERROR),$actor]);
            $this->db->prepare("INSERT INTO audit_events(actor_id,event,target_type,target_id,details) VALUES (?,'media.uploaded','media',?,?::jsonb)")
                ->execute([$actor,$id,json_encode(['kind'=>$kind,'bytes'=>filesize($target),'sha256'=>hash_file('sha256',$target)],JSON_THROW_ON_ERROR)]);
            $this->db->commit();
            return ['id'=>$id,'kind'=>$kind,'mime'=>$mime,'bytes'=>filesize($target),'sha256'=>hash_file('sha256',$target),'metadata'=>$metadata];
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            if ($target && is_file($target)) unlink($target);
            if (is_file($thumb)) unlink($thumb);
            throw $error;
        }
    }

    private static function jpeg(\GdImage $image, string $path, int $max, int $quality): void
    {
        $ratio = min(1,$max/max(imagesx($image),imagesy($image)));
        $width=max(1,(int)round(imagesx($image)*$ratio));$height=max(1,(int)round(imagesy($image)*$ratio));
        $out=imagecreatetruecolor($width,$height);imagefill($out,0,0,imagecolorallocate($out,255,255,255));
        imagecopyresampled($out,$image,0,0,0,0,$width,$height,imagesx($image),imagesy($image));
        try {if (!imagejpeg($out,$path,$quality)) throw new \RuntimeException('Cannot store normalized photo.');} finally {imagedestroy($out);}
    }

    /**
     * Inspect one local video in a subprocess with a 30-second timeout and bounded JSON output.
     */
    private static function probe(string $input): array
    {
        $process=proc_open(['timeout','30s','ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',$input],
            [0=>['pipe','r'],1=>['pipe','w'],2=>['file','/dev/null','a']],$pipes);
        if (!is_resource($process)) throw new \RuntimeException('Video inspection unavailable.');
        fclose($pipes[0]);$result=stream_get_contents($pipes[1],65536);fclose($pipes[1]);$code=proc_close($process);
        $data=json_decode($result,true);$video=null;
        foreach ($data['streams'] ?? [] as $stream) if (($stream['codec_type'] ?? '') === 'video') {$video=$stream;break;}
        $duration=(float)($data['format']['duration'] ?? 0);
        if ($code !== 0 || !$video || !is_finite($duration) || $duration <= 0) throw new ApiError(422,'invalid_media','A complete playable video is required.');
        return ['durationSeconds'=>round($duration,2),'width'=>(int)($video['width'] ?? 0),'height'=>(int)($video['height'] ?? 0),'codec'=>$video['codec_name']];
    }

    /**
     * Collect typed asset references from a validated revision document.
     */
    public static function references(array $document): array
    {
        $refs=[];
        if (!empty($document['video'])) $refs[]=['id'=>$document['video']['id'],'kind'=>'video'];
        foreach ($document['instructions'] as $step) foreach ($step['photos'] ?? [] as $photo) $refs[]=['id'=>$photo['id'],'kind'=>'photo'];
        return $refs;
    }

    /**
     * Validate asset existence/kind and bind it to a new revision inside the caller transaction.
     */
    public function link(string $revisionId, array $document): void
    {
        $refs=self::references($document);if (!$refs) return;
        $ids=array_values(array_unique(array_column($refs,'id')));
        $q=$this->db->prepare('SELECT id,kind FROM media_assets WHERE id IN ('.implode(',',array_fill(0,count($ids),'?')).') FOR SHARE');
        $q->execute($ids);$found=$q->fetchAll(PDO::FETCH_KEY_PAIR);
        foreach ($refs as $ref) if (($found[$ref['id']] ?? null) !== $ref['kind']) throw new ApiError(422,'invalid_media','An attachment does not exist or has the wrong kind.');
        $q=$this->db->prepare('INSERT INTO revision_media(revision_id,media_id) VALUES (?,?)');
        foreach ($ids as $id) $q->execute([$revisionId,$id]);
    }

    /**
     * Resolve private file metadata after checking editor or current-publication visibility.
     */
    public function get(string $id, bool $editor): array
    {
        $sql='SELECT m.* FROM media_assets m WHERE m.id = ?';
        if (!$editor) $sql.=' AND EXISTS (SELECT 1 FROM revision_media rm JOIN route_variants v ON v.published_revision_id = rm.revision_id WHERE rm.media_id = m.id AND v.deleted_at IS NULL)';
        $q=$this->db->prepare($sql);$q->execute([$id]);$row=$q->fetch();
        if (!$row || !is_file(self::directory().'/'.$row['id'].'.'.$row['extension'])) throw new ApiError(404,'not_found','Media not found.');
        return $row;
    }

    /**
     * Load bounded local JPEG thumbnails indexed by asset UUID; never fetch remote report content.
     */
    public function reportImages(array $document): array
    {
        $images=[];
        foreach (self::references($document) as $ref) if ($ref['kind']==='photo' && !isset($images[$ref['id']])) {
            $path=self::directory().'/'.$ref['id'].'.thumb.jpg';
            if (is_file($path)) $images[$ref['id']]='data:image/jpeg;base64,'.base64_encode(file_get_contents($path));
        }
        return $images;
    }

    /**
     * Serve authorized GET/HEAD using Nginx internal offload or a bounded PHP byte-range stream.
     *
     * The caller must obtain this asset through get() first. Direct internal media URLs
     * are denied by Nginx; no session or asset is cached by the service worker.
     */
    public static function serve(array $asset, bool $head=false): never
    {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        header('Content-Type: '.$asset['mime']);header('Content-Disposition: inline; filename="'.$asset['id'].'.'.$asset['extension'].'"');
        header('Accept-Ranges: bytes');header('Cache-Control: private, no-store');
        $size=(int)$asset['bytes'];$start=0;$end=$size-1;
        if (getenv('MEDIA_ACCEL_REDIRECT') === '1') {
            header('X-Accel-Redirect: /_protected_media/'.$asset['id'].'.'.$asset['extension']);exit;
        }
        // Development/test fallback. Production Nginx serves file bytes/ranges only
        // after PHP authorizes the media reference in the current publication.
        if (isset($_SERVER['HTTP_RANGE'])) {
            if (!preg_match('/^bytes=(\d*)-(\d*)$/D',$_SERVER['HTTP_RANGE'],$match) || ($match[1]==='' && $match[2]==='')) self::invalidRange($size);
            if ($match[1]==='') {$length=(int)$match[2];if ($length<1) self::invalidRange($size);$start=max(0,$size-$length);}
            else {$start=(int)$match[1];if ($match[2]!=='') $end=min($end,(int)$match[2]);}
            if ($start>$end || $start>=$size) self::invalidRange($size);
            http_response_code(206);header("Content-Range: bytes $start-$end/$size");
        }
        header('Content-Length: '.($end-$start+1));
        if ($head) exit;
        $stream=fopen(self::directory().'/'.$asset['id'].'.'.$asset['extension'],'rb');fseek($stream,$start);
        $remaining=$end-$start+1;
        while ($remaining>0 && !feof($stream) && !connection_aborted()) {$chunk=fread($stream,min(65536,$remaining));echo $chunk;$remaining-=strlen($chunk);}
        fclose($stream);exit;
    }

    private static function invalidRange(int $size): never
    {
        header('Content-Range: bytes */'.$size);throw new ApiError(416,'invalid_range','Requested byte range is not available.');
    }
}
