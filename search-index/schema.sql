CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS search_source_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL,
  scope_key text NOT NULL DEFAULT 'all',
  status text NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expected_count integer,
  returned_count integer NOT NULL DEFAULT 0,
  linked_count integer NOT NULL DEFAULT 0,
  ambiguous_count integer NOT NULL DEFAULT 0,
  unlinked_count integer NOT NULL DEFAULT 0,
  source_updated_at timestamptz,
  coverage_date_from date,
  coverage_date_to date,
  warning text,
  CHECK (expected_count IS NULL OR expected_count >= 0),
  CHECK ((coverage_date_from IS NULL AND coverage_date_to IS NULL) OR
    (coverage_date_from IS NOT NULL AND coverage_date_to IS NOT NULL AND
      coverage_date_from <= coverage_date_to))
);

ALTER TABLE search_source_runs ADD COLUMN IF NOT EXISTS coverage_date_from date;
ALTER TABLE search_source_runs ADD COLUMN IF NOT EXISTS coverage_date_to date;
ALTER TABLE search_source_runs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS search_source_runs_lookup
  ON search_source_runs (source_id, scope_key, started_at DESC);

CREATE TABLE IF NOT EXISTS search_active_runs (
  source_id text NOT NULL,
  scope_key text NOT NULL DEFAULT 'all',
  run_id bigint NOT NULL REFERENCES search_source_runs(id),
  PRIMARY KEY (source_id, scope_key)
);

CREATE TABLE IF NOT EXISTS search_records (
  run_id bigint NOT NULL REFERENCES search_source_runs(id),
  source_id text NOT NULL,
  record_id text NOT NULL,
  source_url text NOT NULL,
  published_type text,
  published_status text,
  event_date date,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry geometry(Geometry, 4326),
  PRIMARY KEY (run_id, source_id, record_id)
);

-- Search predicates use explicit published fields (fields->>'name'), never
-- jsonb containment. The general GIN index consumes scarce storage without
-- serving these queries, including on every superseded refresh run.
DROP INDEX IF EXISTS search_records_fields;
CREATE INDEX IF NOT EXISTS search_records_geometry ON search_records USING gist (geometry);
CREATE INDEX IF NOT EXISTS search_records_type_date
  ON search_records (source_id, published_type, published_status, event_date);

CREATE TABLE IF NOT EXISTS search_record_parcels (
  run_id bigint NOT NULL,
  source_id text NOT NULL,
  record_id text NOT NULL,
  city_parcel_id bigint NOT NULL,
  city_objectid bigint NOT NULL,
  city_address_objectid bigint,
  match_method text NOT NULL,
  join_status text NOT NULL DEFAULT 'exact' CHECK (join_status IN ('exact', 'ambiguous')),
  FOREIGN KEY (run_id, source_id, record_id)
    REFERENCES search_records (run_id, source_id, record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS search_record_parcels_unique
  ON search_record_parcels (run_id, source_id, record_id, city_parcel_id,
    city_objectid, COALESCE(city_address_objectid, -1));
CREATE INDEX IF NOT EXISTS search_record_parcels_parcel
  ON search_record_parcels (city_parcel_id, city_objectid, run_id, source_id);

-- Old run rows are retained for a bounded audit period, but only the run named
-- in search_active_runs is a current search source. Published historical rows
-- remain in the active run when the publisher still returns them.
