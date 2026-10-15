<?php
declare(strict_types=1);
namespace GttTrainer;

use PDO;

final class RouteRepository
{
    public function __construct(private PDO $db) {}

    public function list(bool $editor, bool $trash = false): array
    {
        $sql = 'SELECT r.*, v.version, v.deleted_at FROM route_revisions r JOIN route_variants v ON v.id = r.variant_id WHERE ';
        $sql .= $trash && $editor ? 'v.deleted_at IS NOT NULL' : 'v.deleted_at IS NULL';
        $sql .= $editor ? " AND (r.id = v.published_revision_id OR r.status IN ('draft','review'))" : ' AND r.id = v.published_revision_id';
        $sql .= ' ORDER BY v.created_at, r.revision';
        return array_map($this->snapshot(...), $this->db->query($sql)->fetchAll());
    }

    public function get(string $id, bool $editor, ?string $revisionId = null): array
    {
        $q = $this->db->prepare('SELECT r.*, v.version, v.deleted_at FROM route_revisions r JOIN route_variants v ON v.id = r.variant_id WHERE v.id = ?'
            .($editor ? '' : ' AND v.deleted_at IS NULL AND r.id = v.published_revision_id')
            .($revisionId ? ' AND r.id = ?' : ($editor ? " AND (r.id = v.published_revision_id OR r.status IN ('draft','review'))" : ''))
            .' ORDER BY r.revision DESC LIMIT 1');
        $q->execute($revisionId ? [$id, $revisionId] : [$id]);
        $row = $q->fetch();
        if (!$row) throw new ApiError(404, 'not_found', 'Route or revision not found.');
        return $this->snapshot($row);
    }

    public function history(string $id): array
    {
        $q = $this->db->prepare('SELECT id, revision, status, created_at FROM route_revisions WHERE variant_id = ? ORDER BY revision DESC');
        $q->execute([$id]);
        return $q->fetchAll();
    }

    public function stops(): array
    {
        return $this->db->query("SELECT id, external_code AS code, name, ST_AsGeoJSON(position)::json AS geometry FROM stops WHERE deleted_at IS NULL ORDER BY name LIMIT 20000")->fetchAll();
    }

    public function create(array $document, string $actor): array
    {
        return $this->transaction(function () use ($document, $actor) {
            $id = Database::uuid();
            $lineId = $this->line($document['line']);
            $this->db->prepare('INSERT INTO route_variants(id,line_id,name,kind,direction) VALUES (?,?,?,?,?)')
                ->execute([$id, $lineId, $document['name'], $document['kind'], $document['direction']]);
            $revision = $this->insertRevision($id, 1, $document, $actor);
            $this->audit($actor, 'route.created', $id, ['revision_id' => $revision]);
            return $this->get($id, true, $revision);
        });
    }

    public function createMany(array $documents, string $actor): array
    {
        return $this->transaction(fn() => array_map(fn($document) => $this->create($document, $actor), $documents));
    }

    public function save(string $id, int $version, array $document, string $actor): array
    {
        return $this->transaction(function () use ($id, $version, $document, $actor) {
            $this->lock($id, $version);
            return $this->newDraft($id, $document, $actor, 'route.saved');
        });
    }

    public function revert(string $id, int $version, string $revisionId, string $actor): array
    {
        return $this->transaction(function () use ($id, $version, $revisionId, $actor) {
            $this->lock($id, $version);
            $previous = $this->get($id, true, $revisionId);
            return $this->newDraft($id, RouteValidator::document($previous), $actor, 'route.reverted');
        });
    }

    public function transition(string $id, int $version, string $revisionId, string $action, string $actor): array
    {
        return $this->transaction(function () use ($id, $version, $revisionId, $action, $actor) {
            $this->lock($id, $version);
            $route = $this->get($id, true, $revisionId);
            $required = $action === 'publish' ? 'review' : 'draft';
            if ($route['status'] !== $required) throw new ApiError(409, 'invalid_transition', 'The revision is not in the required workflow state.');
            if ($action === 'publish') {
                if ($route['source']['name'] === '' || count($route['instructions']) < 2) throw new ApiError(422, 'publication_incomplete', 'Add a source and reviewed instructions before publishing.');
                $this->db->prepare("UPDATE route_revisions SET status = 'archived' WHERE variant_id = ? AND status = 'published'")->execute([$id]);
                $this->db->prepare("UPDATE route_revisions SET status = 'published' WHERE id = ?")->execute([$revisionId]);
                $this->db->prepare('UPDATE route_variants SET published_revision_id = ?, line_id = ?, name = ?, kind = ?, direction = ?, version = version + 1 WHERE id = ?')
                    ->execute([$revisionId, $this->line($route['line']), $route['name'], $route['kind'], $route['direction'], $id]);
            } else {
                $this->db->prepare("UPDATE route_revisions SET status = 'review' WHERE id = ?")->execute([$revisionId]);
                $this->bump($id);
            }
            $this->audit($actor, 'route.'.$action, $id, ['revision_id' => $revisionId]);
            return $this->get($id, true, $revisionId);
        });
    }

    public function trash(string $id, int $version, bool $restore, string $actor): void
    {
        $this->transaction(function () use ($id, $version, $restore, $actor) {
            $this->lock($id, $version, $restore);
            $this->db->prepare('UPDATE route_variants SET deleted_at = '.($restore ? 'NULL' : 'now()').', version = version + 1 WHERE id = ?')->execute([$id]);
            $this->audit($actor, $restore ? 'route.restored' : 'route.deleted', $id);
        });
    }

    public function audit(?string $actor, string $event, ?string $id = null, array $details = []): void
    {
        $this->db->prepare("INSERT INTO audit_events(actor_id,event,target_type,target_id,details) VALUES (?,?,'route',?,?::jsonb)")
            ->execute([$actor, $event, $id, json_encode($details, JSON_THROW_ON_ERROR)]);
    }

    private function newDraft(string $id, array $document, string $actor, string $event): array
    {
        $this->db->prepare("UPDATE route_revisions SET status = 'archived' WHERE variant_id = ? AND status IN ('draft','review')")->execute([$id]);
        $q = $this->db->prepare('SELECT COALESCE(MAX(revision),0) + 1 FROM route_revisions WHERE variant_id = ?');
        $q->execute([$id]);
        $revision = $this->insertRevision($id, (int) $q->fetchColumn(), $document, $actor);
        $this->bump($id);
        $this->audit($actor, $event, $id, ['revision_id' => $revision]);
        return $this->get($id, true, $revision);
    }

    private function insertRevision(string $id, int $number, array $document, string $actor): string
    {
        // The registry shares stop identity; each revision retains its own immutable stop snapshot.
        foreach ($document['stops'] as &$stop) {
            if ($stop['code'] !== '') {
                $q = $this->db->prepare('SELECT id FROM stops WHERE external_code = ?');
                $q->execute([$stop['code']]);
                if ($canonical = $q->fetchColumn()) $stop['id'] = $canonical;
            }
            $q = $this->db->prepare('SELECT external_code FROM stops WHERE id = ?');
            $q->execute([$stop['id']]);
            $existing = $q->fetch();
            if ($existing && ($existing['external_code'] ?? '') !== $stop['code']) throw new ApiError(409, 'stop_conflict', 'A stop identity cannot change its external code.');
            $this->db->prepare('INSERT INTO stops(id,external_code,name,position) VALUES (?,?,?,ST_SetSRID(ST_MakePoint(?,?),4326)) ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position')
                ->execute([$stop['id'], $stop['code'] ?: null, $stop['name'], ...$stop['coordinates']]);
        }
        unset($stop);
        $revision = Database::uuid();
        $this->db->prepare("INSERT INTO route_revisions(id,variant_id,revision,shape,status,document,created_by) VALUES (?,?,?,ST_SetSRID(ST_GeomFromGeoJSON(?),4326),'draft',?::jsonb,?)")
            ->execute([$revision, $id, $number, json_encode($document['geometry'], JSON_THROW_ON_ERROR), json_encode($document, JSON_THROW_ON_ERROR), $actor]);
        foreach ($document['stops'] as $sequence => $stop) {
            $this->db->prepare('INSERT INTO route_stops(revision_id,stop_id,sequence,is_exchange_post,exchange_direction,notes,snapshot) VALUES (?,?,?,?::boolean,?,?,?::jsonb)')
                ->execute([$revision, $stop['id'], $sequence, $stop['exchange'] ? 'true' : 'false', $stop['exchangeDirection'], $stop['notes'], json_encode($stop, JSON_THROW_ON_ERROR)]);
        }
        foreach ($document['instructions'] as $sequence => $instruction) {
            $this->db->prepare('INSERT INTO route_instructions(revision_id,sequence,offset_m,maneuver,landmark_notes) VALUES (?,?,?,?,?)')
                ->execute([$revision, $sequence, $instruction['offsetM'], $instruction['text'], $instruction['notes']]);
        }
        return $revision;
    }

    private function line(string $code): string
    {
        $q = $this->db->prepare('INSERT INTO lines(code,name) VALUES (?,?) ON CONFLICT(code) DO UPDATE SET code = EXCLUDED.code RETURNING id');
        $q->execute([$code, $code]);
        return $q->fetchColumn();
    }

    private function lock(string $id, int $version, bool $allowDeleted = false): void
    {
        $q = $this->db->prepare('SELECT version, deleted_at FROM route_variants WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $row = $q->fetch();
        if (!$row || (!$allowDeleted && $row['deleted_at'] !== null)) throw new ApiError(404, 'not_found', 'Route not found.');
        if ((int) $row['version'] !== $version) throw new ApiError(409, 'version_conflict', 'This route changed. Reload before saving.');
    }

    private function bump(string $id): void
    {
        $this->db->prepare('UPDATE route_variants SET version = version + 1 WHERE id = ?')->execute([$id]);
    }

    private function snapshot(array $row): array
    {
        return array_merge(json_decode($row['document'], true, 512, JSON_THROW_ON_ERROR), [
            'id' => $row['variant_id'], 'revisionId' => $row['id'], 'revision' => (int) $row['revision'],
            'status' => $row['status'], 'version' => (int) $row['version'], 'deleted' => $row['deleted_at'] !== null,
            'createdAt' => $row['created_at'],
        ]);
    }

    private function transaction(callable $work): mixed
    {
        $ownsTransaction = !$this->db->inTransaction();
        if ($ownsTransaction) $this->db->beginTransaction();
        try {
            $result = $work();
            if ($ownsTransaction) $this->db->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($ownsTransaction && $this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }
}
