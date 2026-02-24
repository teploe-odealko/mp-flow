-- Plugin ali1688: private tables in schema plugin_ali1688
-- This file runs with search_path = plugin_ali1688, public

CREATE TABLE IF NOT EXISTS enrichment_cache (
    url_hash    TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    response    JSONB NOT NULL,
    fetched_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichment_log (
    id          SERIAL PRIMARY KEY,
    card_id     UUID NOT NULL,
    user_id     UUID NOT NULL,
    url         TEXT NOT NULL,
    source_key  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
