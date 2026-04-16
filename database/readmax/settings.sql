SET search_path TO readmax;

-- User settings (reader preferences, synced as a single JSONB blob)

CREATE TABLE readmax.user_settings (
    user_id UUID PRIMARY KEY REFERENCES readmax.user(id),
    settings JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync cursors (per-entity-type high-water marks for incremental sync)

CREATE TABLE readmax.sync_cursor (
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    entity_type TEXT NOT NULL,
    cursor TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, entity_type)
);
