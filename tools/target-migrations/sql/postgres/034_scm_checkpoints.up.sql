-- Central transport authority only. No BUSINESS/GLOBAL grant is created.
CREATE TABLE platform.scm_checkpoints (
    installation_id uuid NOT NULL,
    device_id uuid NOT NULL,
    trust_revision bigint NOT NULL CHECK (trust_revision > 0 AND trust_revision <= 9007199254740991),
    envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'
        AND envelope ? 'checkpoint' AND envelope ? 'signature'
        AND jsonb_typeof(envelope->'checkpoint') = 'object'
        AND (envelope->'checkpoint') ?& ARRAY['installation_id','device_id','trust_revision']
        AND (envelope->>'signature') ~ '^[A-Za-z0-9_-]{86}$'),
    published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (installation_id,device_id,trust_revision),
    CHECK ((envelope->'checkpoint'->>'installation_id')::uuid = installation_id),
    CHECK ((envelope->'checkpoint'->>'device_id')::uuid = device_id),
    CHECK ((envelope->'checkpoint'->>'trust_revision')::bigint = trust_revision)
);
ALTER TABLE platform.scm_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.scm_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY scm_central ON platform.scm_checkpoints TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY scm_owner ON platform.scm_checkpoints TO pos_schema_owner USING (true) WITH CHECK (true);
REVOKE ALL ON platform.scm_checkpoints FROM PUBLIC,pos_app,pos_worker,pos_reporting,pos_platform_admin;
GRANT SELECT,INSERT ON platform.scm_checkpoints TO pos_platform_app;
CREATE FUNCTION platform.guard_scm_checkpoint_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'SCM_CHECKPOINT_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER scm_checkpoint_history_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON platform.scm_checkpoints
FOR EACH STATEMENT EXECUTE FUNCTION platform.guard_scm_checkpoint_history();
REVOKE ALL ON FUNCTION platform.guard_scm_checkpoint_history() FROM PUBLIC;
