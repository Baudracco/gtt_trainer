CREATE TABLE media_assets (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('photo','video')),
    mime text NOT NULL CHECK (mime IN ('image/jpeg','video/mp4','video/webm')),
    extension text NOT NULL CHECK (extension IN ('jpg','mp4','webm')),
    bytes bigint NOT NULL CHECK (bytes > 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
    original_name text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE revision_media (
    revision_id uuid NOT NULL REFERENCES route_revisions(id),
    media_id uuid NOT NULL REFERENCES media_assets(id),
    PRIMARY KEY(revision_id,media_id)
);
CREATE INDEX revision_media_asset_idx ON revision_media(media_id);
CREATE TRIGGER immutable_revision_media BEFORE INSERT OR UPDATE OR DELETE ON revision_media
    FOR EACH ROW EXECUTE FUNCTION protect_revision_child();
CREATE FUNCTION deny_media_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Media assets are immutable; upload a new asset instead'; END $$;
CREATE TRIGGER immutable_media_asset BEFORE UPDATE OR DELETE ON media_assets
    FOR EACH ROW EXECUTE FUNCTION deny_media_mutation();
