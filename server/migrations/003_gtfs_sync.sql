-- Source identity is separate from a variant's immutable publication and editor work.
CREATE TABLE gtfs_sync (
    provider text PRIMARY KEY CHECK (provider = 'gtt'),
    archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
    downloaded_at timestamptz NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    manifest jsonb NOT NULL,
    summary jsonb NOT NULL
);

CREATE TABLE gtfs_route_links (
    source_key text PRIMARY KEY CHECK (source_key ~ '^gtt:[0-9a-f]{64}$'),
    variant_id uuid UNIQUE REFERENCES route_variants(id),
    source_revision_id uuid REFERENCES route_revisions(id),
    content_hash text,
    last_seen_sha256 text NOT NULL,
    state text NOT NULL CHECK (state IN ('current','conflict','rejected','missing','deleted')),
    reason text NOT NULL DEFAULT '',
    identity jsonb NOT NULL,
    pending_document jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
