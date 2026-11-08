-- QR-001: Central Payments owns free merchant destination configuration.
-- This migration does NOT create any banking integration, confirm payments,
-- or authorize callers. HTTP authorization is a separate required gate.
-- Target: PostgreSQL 16.14 through canonical commercial migration runner.
CREATE TABLE payments.merchant_qr_assets (
 id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
 tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 png_bytes bytea NOT NULL CHECK (octet_length(png_bytes) BETWEEN 57 AND 1048576),
 content_type text NOT NULL CHECK (content_type = 'image/png'),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(tenant_id,company_id,id),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id)
);
CREATE TABLE payments.merchant_destinations (
 id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
 tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('NEQUI_NUMBER','BREB_KEY','NEQUI_BUSINESS_QR')),
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
 destination_reference text NOT NULL CHECK (char_length(destination_reference) BETWEEN 4 AND 160),
 qr_asset_id uuid,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','REVOKED')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL,
 published_at timestamptz, revoked_at timestamptz,
 UNIQUE(tenant_id,company_id,id),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id),
 FOREIGN KEY (tenant_id,company_id,qr_asset_id)
   REFERENCES payments.merchant_qr_assets(tenant_id,company_id,id),
 CHECK (kind<>'NEQUI_BUSINESS_QR' OR qr_asset_id IS NOT NULL),
 CHECK ((status='DRAFT' AND published_at IS NULL AND revoked_at IS NULL)
     OR (status='PUBLISHED' AND published_at IS NOT NULL AND revoked_at IS NULL)
     OR (status='REVOKED' AND published_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX merchant_destination_one_published_kind
 ON payments.merchant_destinations(tenant_id,company_id,kind)
 WHERE status='PUBLISHED';

CREATE TABLE payments.merchant_destination_events (
 event_id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(event_id)),
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, destination_id uuid NOT NULL,
 destination_version bigint NOT NULL CHECK (destination_version>0),
 event_type text NOT NULL CHECK (event_type IN
   ('DESTINATION_DRAFT_CREATED','DESTINATION_PUBLISHED','DESTINATION_REVOKED')),
 actor_user_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
 UNIQUE(tenant_id,company_id,destination_id,destination_version),
 FOREIGN KEY (tenant_id,company_id,destination_id)
   REFERENCES payments.merchant_destinations(tenant_id,company_id,id)
);
CREATE TABLE payments.merchant_destination_outbox (
 event_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 destination_id uuid NOT NULL, destination_version bigint NOT NULL,
 payload_json jsonb NOT NULL,
 recorded_at timestamptz NOT NULL,
 FOREIGN KEY(event_id) REFERENCES payments.merchant_destination_events(event_id),
 FOREIGN KEY (tenant_id,company_id,destination_id)
   REFERENCES payments.merchant_destinations(tenant_id,company_id,id)
);
CREATE TABLE payments.merchant_destination_sequences (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,company_id),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id)
);
CREATE TABLE payments.merchant_destination_acknowledgements (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, installation_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 acknowledged_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,company_id,installation_id),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id),
 FOREIGN KEY (installation_id) REFERENCES identity.device_registry(installation_id)
);

-- A published destination can only be revoked, never edited in place.
CREATE FUNCTION payments.guard_merchant_destination_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
BEGIN
 IF ROW(NEW.id,NEW.tenant_id,NEW.company_id,NEW.kind,NEW.label,
        NEW.destination_reference,NEW.qr_asset_id,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.tenant_id,OLD.company_id,OLD.kind,OLD.label,
        OLD.destination_reference,OLD.qr_asset_id,OLD.created_by,OLD.created_at)
 OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'merchant destination immutable fields/version mismatch';
 END IF;
 IF NOT (
   (OLD.status='DRAFT' AND NEW.status='PUBLISHED'
       AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL
       AND NEW.revoked_at IS NULL)
   OR (OLD.status='PUBLISHED' AND NEW.status='REVOKED'
       AND NEW.published_at=OLD.published_at AND NEW.revoked_at IS NOT NULL
       AND NEW.revoked_at>=OLD.published_at)
 ) THEN RAISE EXCEPTION 'invalid merchant destination lifecycle'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_destination_transition
 BEFORE UPDATE ON payments.merchant_destinations FOR EACH ROW
 EXECUTE FUNCTION payments.guard_merchant_destination_transition();
CREATE FUNCTION payments.guard_merchant_monotonic_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
BEGIN
 IF ROW(NEW.tenant_id,NEW.company_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.company_id)
 OR NEW.sequence<=OLD.sequence THEN
   RAISE EXCEPTION 'merchant destination sequence regression';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_sequence_monotonic
 BEFORE UPDATE ON payments.merchant_destination_sequences FOR EACH ROW
 EXECUTE FUNCTION payments.guard_merchant_monotonic_sequence();
CREATE TRIGGER merchant_ack_monotonic
 BEFORE UPDATE ON payments.merchant_destination_acknowledgements FOR EACH ROW
 EXECUTE FUNCTION payments.guard_merchant_monotonic_sequence();

-- Strict initialization and immutable evidence. No direct DELETE/TRUNCATE.
CREATE FUNCTION payments.guard_merchant_destination_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
BEGIN
 IF NEW.status<>'DRAFT' OR NEW.version<>1 OR
    NEW.published_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
   RAISE EXCEPTION 'merchant destination must start as draft v1';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_destination_insert
 BEFORE INSERT ON payments.merchant_destinations FOR EACH ROW
 EXECUTE FUNCTION payments.guard_merchant_destination_insert();

CREATE FUNCTION payments.guard_merchant_ack_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
BEGIN
 IF TG_OP='UPDATE' AND NEW.installation_id<>OLD.installation_id THEN
   RAISE EXCEPTION 'merchant acknowledgement installation immutable';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM identity.device_registry d
   WHERE d.installation_id=NEW.installation_id
   AND d.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id
   AND d.status='ACTIVE'
 ) THEN RAISE EXCEPTION 'merchant acknowledgement device scope inactive'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_ack_identity
 BEFORE INSERT OR UPDATE ON payments.merchant_destination_acknowledgements
 FOR EACH ROW EXECUTE FUNCTION payments.guard_merchant_ack_identity();

DO $setup$ DECLARE object text; BEGIN
 FOREACH object IN ARRAY ARRAY[
 'merchant_qr_assets','merchant_destinations','merchant_destination_events',
 'merchant_destination_outbox','merchant_destination_sequences',
 'merchant_destination_acknowledgements'] LOOP
  EXECUTE format('ALTER TABLE payments.%I ENABLE ROW LEVEL SECURITY',object);
  EXECUTE format('ALTER TABLE payments.%I FORCE ROW LEVEL SECURITY',object);
  EXECUTE format($policy$CREATE POLICY merchant_company_scope ON payments.%I
    FOR ALL TO pos_platform_app
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
       AND company_id = nullif(current_setting('app.company_id',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
       AND company_id = nullif(current_setting('app.company_id',true),'')::uuid)$policy$,object);
  EXECUTE format('CREATE TRIGGER merchant_no_truncate BEFORE TRUNCATE ON payments.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation()',object);
 END LOOP;
END $setup$;
-- The central runtime cannot write without explicit provisioning and an
-- authenticated authorization handler; grants are intentionally restricted.
REVOKE ALL ON ALL TABLES IN SCHEMA payments FROM PUBLIC,pos_app,pos_worker,pos_reporting;
REVOKE ALL ON FUNCTION payments.guard_merchant_destination_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.guard_merchant_monotonic_sequence() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.guard_merchant_destination_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.guard_merchant_ack_identity() FROM PUBLIC;
GRANT USAGE ON SCHEMA payments TO pos_platform_app;
-- Local merchant POS roles receive no DB rights.
GRANT SELECT,INSERT ON payments.merchant_qr_assets TO pos_platform_app;
GRANT SELECT,INSERT,UPDATE ON payments.merchant_destinations TO pos_platform_app;
GRANT SELECT,INSERT ON payments.merchant_destination_events TO pos_platform_app;
GRANT SELECT,INSERT ON payments.merchant_destination_outbox TO pos_platform_app;
GRANT SELECT,INSERT,UPDATE ON payments.merchant_destination_sequences TO pos_platform_app;
GRANT SELECT,INSERT,UPDATE ON payments.merchant_destination_acknowledgements TO pos_platform_app;


CREATE TRIGGER merchant_asset_immutable BEFORE UPDATE OR DELETE ON payments.merchant_qr_assets
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_event_immutable BEFORE UPDATE OR DELETE ON payments.merchant_destination_events
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_outbox_immutable BEFORE UPDATE OR DELETE ON payments.merchant_destination_outbox
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_destination_no_delete BEFORE DELETE ON payments.merchant_destinations
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_sequences_no_delete BEFORE DELETE ON payments.merchant_destination_sequences
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_ack_no_delete BEFORE DELETE ON payments.merchant_destination_acknowledgements
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
