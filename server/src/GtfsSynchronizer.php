<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

/** Trusted CLI ingestion only; the web API can inspect but cannot trigger downloads. */
final class GtfsSynchronizer
{
    /**
     * Bind the trusted CLI ingestion/database connection.
     */
    public function __construct(private PDO $db) {}

    /**
     * Hash normalized route content excluding download date and canonical stop UUID substitutions.
     */
    public static function fingerprint(array $document): string
    {
        $document = RouteValidator::document($document);
        unset($document['source']['retrievedAt']);
        foreach ($document['stops'] as &$stop) unset($stop['id']);
        unset($stop);
        return hash('sha256', json_encode($document, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
    }

    /**
     * Apply one validated source bundle atomically under the GTFS advisory transaction lock.
     *
     * Adopt exact existing snapshots, append source-only changes as drafts and retain
     * manual/review conflicts separately. Missing/rejected/trash never remove publications.
     * @return array Counts for created/adopted/updated/unchanged/conflicts/rejected/missing/deleted.
     */
    public function apply(array $bundle): array
    {
        if (($bundle['schemaVersion'] ?? null) !== 1 || ($bundle['provider'] ?? '') !== 'gtt'
            || !preg_match('/^[a-f0-9]{64}$/D', $bundle['archiveSha256'] ?? '')
            || !is_array($bundle['variants'] ?? null) || !array_is_list($bundle['variants']) || count($bundle['variants']) < 1
            || count($bundle['variants']) > 2000 || !is_array($bundle['rejected'] ?? null)) {
            throw new \InvalidArgumentException('Invalid GTFS bundle.');
        }
        $sha = $bundle['archiveSha256']; $seen = []; $incoming = [];
        foreach (array_merge($bundle['variants'], $bundle['rejected']) as $entry) {
            $key = $entry['key'] ?? '';
            if (!preg_match('/^gtt:[a-f0-9]{64}$/D', $key) || isset($seen[$key])) throw new \InvalidArgumentException('Invalid/duplicate GTFS source key.');
            $seen[$key] = true;
        }
        foreach ($bundle['variants'] as $entry) {
            $entry['document'] = RouteValidator::document($entry['document']);
            $incoming[] = $entry;
        }
        $this->db->beginTransaction();
        try {
            $this->db->exec("SELECT pg_advisory_xact_lock(hashtext('gtt-trainer-gtfs-sync'))");
            $repo = new RouteRepository($this->db);
            $links = $this->db->query('SELECT * FROM gtfs_route_links')->fetchAll(PDO::FETCH_UNIQUE);
            $summary = array_fill_keys(['created','adopted','updated','unchanged','conflicts','rejected','missing','deleted'], 0);
            // Adopt only an exact, unique existing source snapshot. A changed/editorial
            // document is never silently associated just because its name looks similar.
            $adoptable = [];
            if (!$links) foreach ($repo->list(true) as $route) {
                if ($route['source']['url'] === 'https://www.gtt.to.it/open_data/gtt_gtfs.zip') {
                    $adoptable[self::fingerprint($route)][] = $route;
                }
            }
            foreach ($incoming as $entry) {
                $key = $entry['key']; $doc = $entry['document']; $hash = self::fingerprint($doc);
                $link = $links[$key] ?? null; $route = null; $pending = null; $reason = ''; $state = 'current';
                if ($link && $link['variant_id']) {
                    $q = $this->db->prepare('SELECT version, deleted_at FROM route_variants WHERE id = ? FOR UPDATE');
                    $q->execute([$link['variant_id']]); $variant = $q->fetch();
                    $route = $repo->get($link['variant_id'], true);
                    if ($variant['deleted_at'] !== null) {
                        $state = 'deleted'; $reason = 'Local route is in trash; automatic sync cannot restore it.';
                        $pending = $doc; ++$summary['deleted'];
                    } elseif ($hash === $link['content_hash']) {
                        // Source is unchanged even when a human added notes/instructions.
                        ++$summary['unchanged'];
                    } elseif (in_array($route['status'], ['draft','review'], true) && $route['revisionId'] !== $link['source_revision_id']) {
                        $state = 'conflict'; $reason = 'A manually saved working revision exists; incoming source retained separately.';
                        $pending = $doc; ++$summary['conflicts'];
                    } elseif ($route['status'] === 'review') {
                        $state = 'conflict'; $reason = 'The source revision is under review; incoming source retained separately.';
                        $pending = $doc; ++$summary['conflicts'];
                    } else {
                        $route = $repo->save($route['id'], (int)$variant['version'], $doc, null);
                        ++$summary['updated'];
                    }
                } else {
                    $matches = $adoptable[$hash] ?? [];
                    if (count($matches) === 1) {
                        $route = $matches[0]; unset($adoptable[$hash]); ++$summary['adopted'];
                    } else {
                        $route = $repo->create($doc, null); ++$summary['created'];
                    }
                }
                $sourceRevision = $pending ? ($link['source_revision_id'] ?? null) : ($hash === ($link['content_hash'] ?? null) ? $link['source_revision_id'] : $route['revisionId']);
                $this->write($entry, $sha, $route['id'], $sourceRevision, $pending ? ($link['content_hash'] ?? null) : $hash, $state, $reason, $pending);
            }
            foreach ($bundle['rejected'] as $entry) {
                $link = $links[$entry['key']] ?? null;
                $this->write($entry, $sha, $link['variant_id'] ?? null, $link['source_revision_id'] ?? null, $link['content_hash'] ?? null,
                    'rejected', (string)$entry['reason'], null);
                ++$summary['rejected'];
            }
            foreach ($links as $key => $link) if (!isset($seen[$key])) {
                $this->db->prepare("UPDATE gtfs_route_links SET state = 'missing', reason = 'Not present in the latest selected feed; local history and publication retained.', pending_document = NULL, updated_at = now() WHERE source_key = ?")
                    ->execute([$key]);
                ++$summary['missing'];
            }
            $manifest = $bundle; unset($manifest['variants']);
            $this->db->prepare('INSERT INTO gtfs_sync(provider,archive_sha256,downloaded_at,manifest,summary) VALUES (\'gtt\',?,?,?::jsonb,?::jsonb) ON CONFLICT(provider) DO UPDATE SET archive_sha256 = EXCLUDED.archive_sha256, downloaded_at = EXCLUDED.downloaded_at, applied_at = now(), manifest = EXCLUDED.manifest, summary = EXCLUDED.summary')
                ->execute([$sha, $bundle['downloadedAt'], json_encode($manifest, JSON_THROW_ON_ERROR), json_encode($summary, JSON_THROW_ON_ERROR)]);
            $previousSha = $this->db->prepare("SELECT details->>'sha256' FROM audit_events WHERE event = 'gtfs.synchronized' ORDER BY created_at DESC LIMIT 1");
            $previousSha->execute();
            if ($previousSha->fetchColumn() !== $sha || $summary['created'] || $summary['updated'] || $summary['adopted']) {
                $repo->audit(null, 'gtfs.synchronized', null, ['sha256' => $sha, 'summary' => $summary]);
            }
            $this->db->commit();
            return $summary;
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    private function write(array $entry, string $sha, ?string $variant, ?string $revision, ?string $hash, string $state, string $reason, ?array $pending): void
    {
        unset($entry['document'], $entry['contentHash'], $entry['reason']);
        $this->db->prepare('INSERT INTO gtfs_route_links(source_key,variant_id,source_revision_id,content_hash,last_seen_sha256,state,reason,identity,pending_document) VALUES (?,?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(source_key) DO UPDATE SET variant_id=EXCLUDED.variant_id, source_revision_id=EXCLUDED.source_revision_id, content_hash=EXCLUDED.content_hash, last_seen_sha256=EXCLUDED.last_seen_sha256, state=EXCLUDED.state, reason=EXCLUDED.reason, identity=EXCLUDED.identity, pending_document=EXCLUDED.pending_document, updated_at=now()')
            ->execute([$entry['key'], $variant, $revision, $hash, $sha, $state, $reason, json_encode($entry, JSON_THROW_ON_ERROR), $pending ? json_encode($pending, JSON_THROW_ON_ERROR) : null]);
    }

    /**
     * Return feed provenance, latest import summary, download reservation and unresolved source issues.
     */
    public function status(): array
    {
        $row = $this->db->query("SELECT * FROM gtfs_sync WHERE provider = 'gtt'")->fetch();
        $issues = $this->db->query("SELECT source_key AS key, variant_id AS \"variantId\", state, reason, identity, pending_document IS NOT NULL AS \"hasDocument\" FROM gtfs_route_links WHERE state <> 'current' ORDER BY source_key")->fetchAll();
        foreach ($issues as &$issue) $issue['identity'] = json_decode($issue['identity'], true, 128, JSON_THROW_ON_ERROR);
        unset($issue);
        $download = null; $path = getenv('GTFS_STATE_DIR') ?: dirname(__DIR__).'/var/gtfs';
        if (is_file($path.'/state.json')) {
            $state = json_decode(file_get_contents($path.'/state.json'), true);
            // Explicit allow-list: headers, filesystem paths and error internals are private.
            $download = array_intersect_key($state ?? [], array_flip(['lastAttemptAt','lastDownloadAt','lastCheckedAt','nextAttemptAt','sha256','outcome']));
        }
        return ['archiveSha256' => $row['archive_sha256'] ?? null, 'downloadedAt' => $row['downloaded_at'] ?? null,
            'appliedAt' => $row['applied_at'] ?? null, 'summary' => $row ? json_decode($row['summary'], true) : null,
            'download' => $download, 'issues' => $issues];
    }

    /**
     * Return a retained incoming document for editor inspection/export; never publish it implicitly.
     */
    public function pending(string $key): array
    {
        $q = $this->db->prepare('SELECT pending_document FROM gtfs_route_links WHERE source_key = ? AND pending_document IS NOT NULL');
        $q->execute([$key]); $document = $q->fetchColumn();
        if (!$document) throw new ApiError(404, 'not_found', 'Incoming source document not found.');
        return json_decode($document, true, 128, JSON_THROW_ON_ERROR);
    }
}
