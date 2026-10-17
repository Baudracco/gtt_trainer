<?php
declare(strict_types=1);
namespace GttTrainer;

/**
 * Normalize untrusted route documents without repairing or rerouting their geometry.
 *
 * WGS84 coordinates are longitude then latitude. Stops/instructions must already be
 * in travel order. Exchange metadata belongs to each stop membership and direction.
 * All failures throw ApiError(validation_failed); optional empty media stays omitted.
 */
final class RouteValidator
{
    public const DIRECTIONS = ['andata', 'ritorno', 'circular', 'none'];
    public const KINDS = ['service', 'depot_out', 'depot_in', 'deadhead', 'partial', 'circular'];

    /**
     * Validate and lowercase an identifier; never interpolate unvalidated input into storage paths.
     */
    public static function uuid(mixed $id): string
    {
        if (!is_string($id) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $id)) self::fail('Invalid identifier.');
        return strtolower($id);
    }

    /**
     * Require bounded UTF-8 text and trim outer whitespace, preserving internal observations.
     */
    public static function text(mixed $value, int $max = 200, bool $required = true): string
    {
        if (!is_string($value) || mb_strlen($value) > $max || ($required && trim($value) === '')) self::fail('Invalid text value.');
        return trim($value);
    }

    /**
     * Validate one finite [longitude, latitude] WGS84 position.
     * @return array{0:float,1:float}
     */
    public static function coordinate(mixed $p): array
    {
        if (!is_array($p) || count($p) !== 2 || !is_numeric($p[0] ?? null) || !is_numeric($p[1] ?? null)) self::fail('Coordinates must be [longitude, latitude].');
        $lng = (float) $p[0]; $lat = (float) $p[1];
        if (!is_finite($lng) || !is_finite($lat) || abs($lng) > 180 || abs($lat) > 90) self::fail('Coordinates outside WGS84 bounds.');
        return [$lng, $lat];
    }

    /**
     * Validate a complete travel-ordered fixed-route snapshot and return its canonical document.
     *
     * Does not sort, snap, generate turns, fetch routes or decide operational directions.
     * Unknown fields are discarded; empty photo arrays are omitted for stable fingerprints.
     * @throws ApiError On invalid geometry, limits, memberships, media or offsets.
     */
    public static function document(array $data): array
    {
        $line = self::text($data['line'] ?? null, 40);
        $name = self::text($data['name'] ?? null);
        $direction = $data['direction'] ?? null;
        $kind = $data['kind'] ?? null;
        if (!in_array($direction, self::DIRECTIONS, true) || !in_array($kind, self::KINDS, true)) self::fail('Invalid direction or route kind.');
        $color = $data['color'] ?? '#2463eb';
        if (!is_string($color) || !preg_match('/^#[0-9a-f]{6}$/iD', $color)) self::fail('Color must be #RRGGBB.');
        $geometry = $data['geometry'] ?? [];
        $coords = $geometry['coordinates'] ?? [];
        if (($geometry['type'] ?? '') !== 'LineString' || !is_array($coords) || !array_is_list($coords) || count($coords) < 2 || count($coords) > 50000) self::fail('A route needs 2–50000 ordered LineString vertices.');
        $coords = array_map(self::coordinate(...), $coords);
        $length = 0.0;
        for ($i = 1; $i < count($coords); ++$i) $length += self::distance($coords[$i - 1], $coords[$i]);
        if ($length < 1) self::fail('Route length must be at least one metre.');
        $stopInput = $data['stops'] ?? [];
        $instructionInput = $data['instructions'] ?? [];
        if (!is_array($stopInput) || !array_is_list($stopInput) || count($stopInput) > 1000 || !is_array($instructionInput) || !array_is_list($instructionInput) || count($instructionInput) > 2000) self::fail('Too many stops or instructions.');
        $stops = [];
        $identities = [];
        foreach ($stopInput as $stop) {
            if (!is_array($stop)) self::fail('Invalid stop.');
            $id = self::uuid($stop['id'] ?? null);
            $exchange = $stop['exchange'] ?? false;
            $exchangeDirection = $stop['exchangeDirection'] ?? null;
            if (!is_bool($exchange) || ($exchange && !in_array($exchangeDirection, ['andata','ritorno','circular'], true))) self::fail('An exchange post needs its travel direction.');
            $entry = [
                'id' => $id, 'code' => self::text($stop['code'] ?? '', 100, false),
                'name' => self::text($stop['name'] ?? null), 'coordinates' => self::coordinate($stop['coordinates'] ?? null),
                'offsetM' => self::offset($stop['offsetM'] ?? null, $length),
                'exchange' => $exchange, 'exchangeDirection' => $exchange ? $exchangeDirection : null,
                'notes' => self::text($stop['notes'] ?? '', 4000, false),
            ];
            $identity = [$entry['code'], $entry['name'], $entry['coordinates']];
            if (isset($identities[$id]) && $identities[$id] !== $identity) self::fail('Repeated stop identities must agree.');
            $identities[$id] = $identity;
            $stops[] = $entry;
        }
        $instructions = [];
        $photoCount = 0;
        foreach ($instructionInput as $instruction) {
            if (!is_array($instruction)) self::fail('Invalid instruction.');
            $entry = [
                'offsetM' => self::offset($instruction['offsetM'] ?? null, $length),
                'text' => self::text($instruction['text'] ?? null, 2000),
                'notes' => self::text($instruction['notes'] ?? '', 4000, false),
                'kind' => in_array($instruction['kind'] ?? '', ['depart','straight','left','right','roundabout','arrive','note'], true) ? $instruction['kind'] : 'note',
            ];
            $photos = $instruction['photos'] ?? [];
            if (!is_array($photos) || !array_is_list($photos) || count($photos) > 3) self::fail('Maximum three photos per instruction.');
            $photoCount += count($photos);
            if ($photoCount > 200) self::fail('Maximum 200 photo references per route.');
            if ($photos) $entry['photos'] = array_map(self::media(...), $photos);
            if (count(array_unique(array_column($entry['photos'] ?? [], 'id'))) !== count($photos)) self::fail('Duplicate photo reference on an instruction.');
            $instructions[] = $entry;
        }
        foreach ([$stops, $instructions] as $ordered) {
            $previous = -1;
            foreach ($ordered as $entry) {
                if ($entry['offsetM'] < $previous) self::fail('Stops and instructions must follow travel order.');
                $previous = $entry['offsetM'];
            }
        }
        $source = $data['source'] ?? [];
        if (!is_array($source)) self::fail('Invalid source.');
        $document = [
            'line' => $line, 'name' => $name, 'direction' => $direction, 'kind' => $kind, 'color' => $color,
            'geometry' => ['type' => 'LineString', 'coordinates' => $coords],
            'stops' => $stops, 'instructions' => $instructions, 'notes' => self::text($data['notes'] ?? '', 12000, false),
            'source' => [
                'name' => self::text($source['name'] ?? '', 200, false),
                'url' => self::url($source['url'] ?? ''),
                'license' => self::text($source['license'] ?? '', 500, false),
                'retrievedAt' => self::text($source['retrievedAt'] ?? '', 40, false),
            ],
        ];
        if (isset($source['provenance'])) $document['source']['provenance'] = self::provenance($source['provenance']);
        if (isset($data['video'])) $document['video'] = self::media($data['video']);
        return $document;
    }

    /** Preserve bounded literal source evidence; a checksum identifies text, not editorial approval. */
    private static function provenance(mixed $value): array
    {
        if (!is_array($value)) self::fail('Invalid source provenance.');
        foreach (['documentSha256','textSha256'] as $key) {
            if (!is_string($value[$key] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $value[$key])) self::fail('Invalid source checksum.');
        }
        $pages = $value['pages'] ?? null;
        if (!is_array($pages) || !array_is_list($pages) || count($pages) < 1 || count($pages) > 100 || count(array_unique($pages, SORT_REGULAR)) !== count($pages)) self::fail('Invalid source pages.');
        foreach ($pages as $page) if (!is_int($page) || $page < 1 || $page > 10000) self::fail('Invalid source page.');
        $streets = $value['streets'] ?? null;
        if (!is_array($streets) || !array_is_list($streets) || count($streets) > 200) self::fail('Invalid source streets.');
        $title = self::text($value['title'] ?? null, 500);
        $text = self::text($value['text'] ?? null, 8000);
        if (!hash_equals($value['textSha256'], hash('sha256', $title."\n".$text))) self::fail('Source text checksum mismatch.');
        return ['documentSha256'=>$value['documentSha256'], 'referenceId'=>self::text($value['referenceId'] ?? null,100),
                'movementId'=>self::text($value['movementId'] ?? null,150), 'pages'=>$pages, 'title'=>$title,
                'text'=>$text, 'textSha256'=>$value['textSha256'],
                'streets'=>array_map(fn($street)=>self::text($street,500),$streets)];
    }

    private static function media(mixed $reference): array
    {
        if (!is_array($reference)) self::fail('Invalid media reference.');
        return ['id'=>self::uuid($reference['id'] ?? null), 'caption'=>self::text($reference['caption'] ?? '',500,false), 'credit'=>self::text($reference['credit'] ?? '',500,false)];
    }

    private static function offset(mixed $value, float $length): float
    {
        if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < 0 || $value > $length + 5) self::fail('Offset outside the fixed route.');
        return round((float) $value, 2);
    }

    private static function url(mixed $value): string
    {
        $url = self::text($value, 1000, false);
        if ($url !== '' && (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['https','http'], true))) self::fail('Invalid source URL.');
        return $url;
    }

    /**
     * Measure great-circle distance in metres with the mean Earth radius.
     * @param array $a WGS84 [longitude, latitude].
     * @param array $b WGS84 [longitude, latitude].
     */
    public static function distance(array $a, array $b): float
    {
        $lat1 = deg2rad($a[1]); $lat2 = deg2rad($b[1]);
        $h = sin(($lat2 - $lat1) / 2) ** 2 + cos($lat1) * cos($lat2) * sin(deg2rad($b[0] - $a[0]) / 2) ** 2;
        return 6371008.8 * 2 * asin(sqrt(min(1, $h)));
    }

    private static function fail(string $message): never
    {
        throw new ApiError(422, 'validation_failed', $message);
    }
}
