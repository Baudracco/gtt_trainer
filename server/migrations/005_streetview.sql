CREATE TABLE streetview_cache (
    cache_key text PRIMARY KEY,
    body jsonb NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX streetview_cache_expiry_idx ON streetview_cache(expires_at);
