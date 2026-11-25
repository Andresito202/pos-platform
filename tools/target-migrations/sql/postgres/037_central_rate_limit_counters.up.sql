-- Distributed abuse budgets for Central Authority (multi-instance, no Redis).
-- Single-writer atomic upsert per bucket_key; not a tenant business table.
CREATE TABLE platform.central_rate_limit_counters (
  bucket_key text NOT NULL
    CONSTRAINT central_rate_limit_counters_key_ck CHECK (char_length(btrim(bucket_key)) BETWEEN 1 AND 512),
  count integer NOT NULL
    CONSTRAINT central_rate_limit_counters_count_ck CHECK (count > 0 AND count <= 2147483647),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (bucket_key)
);

CREATE INDEX central_rate_limit_counters_reset_at_idx
  ON platform.central_rate_limit_counters (reset_at);

ALTER TABLE platform.central_rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.central_rate_limit_counters FORCE ROW LEVEL SECURITY;

CREATE POLICY central_rate_limit_counters_central_only ON platform.central_rate_limit_counters
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY central_rate_limit_counters_owner_inspect ON platform.central_rate_limit_counters
  FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON platform.central_rate_limit_counters
  FROM PUBLIC, pos_app, pos_worker, pos_reporting, pos_platform_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.central_rate_limit_counters TO pos_platform_app;
