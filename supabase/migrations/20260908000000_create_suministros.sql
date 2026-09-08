CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.suministros (
    suministro bigint PRIMARY KEY CHECK (suministro > 0),
    latitud double precision NOT NULL CHECK (latitud BETWEEN -18 AND 0),
    longitud double precision NOT NULL CHECK (longitud BETWEEN -82 AND -68),
    precision_decimales smallint NOT NULL CHECK (precision_decimales BETWEEN 0 AND 15),
    actualizado_en timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS private.suministros_sync (
    source_name text PRIMARY KEY,
    source_signature text NOT NULL CHECK (length(source_signature) = 64),
    source_file text NOT NULL,
    source_row_count bigint NOT NULL CHECK (source_row_count >= 0),
    source_updated_at timestamptz NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM anon, authenticated;
