-- Canonical Licensing owner. DEV-003 replaces the legacy DeviceKey UUID model.
CREATE TABLE licensing.trusted_signing_keys (
  key_id text PRIMARY KEY CHECK (btrim(key_id)<>''),
  key_purpose text NOT NULL CHECK (key_purpose='LICENSE'),
  environment text NOT NULL CHECK (environment IN ('PREPRODUCTION','PRODUCTION')),
  public_key bytea NOT NULL,
  public_key_checksum bytea NOT NULL CHECK (octet_length(public_key_checksum)=32),
  algorithm_id text NOT NULL CHECK (algorithm_id='Ed25519'),
  key_status text NOT NULL CHECK (key_status IN ('ACTIVE','VERIFY_ONLY','REVOKED')),
  valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL CHECK (valid_until>valid_from),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(environment,public_key_checksum)
);
CREATE TABLE licensing.license_activations (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  license_id uuid NOT NULL REFERENCES licensing.licenses(id) ON DELETE NO ACTION,
  tenant_id uuid NOT NULL, company_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  installation_id uuid NOT NULL,
  credential_id uuid NOT NULL REFERENCES identity.device_credentials(credential_id) ON DELETE NO ACTION,
  activation_status text NOT NULL CHECK (activation_status IN ('PENDING','ACTIVE','REVOKED')),
  payload_version integer NOT NULL CHECK (payload_version=2),
  license_version bigint NOT NULL CHECK (license_version>0),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
  request_checksum bytea NOT NULL CHECK (octet_length(request_checksum)=32),
  idempotency_key uuid NOT NULL,
  signing_key_id text NOT NULL REFERENCES licensing.trusted_signing_keys(key_id) ON DELETE NO ACTION,
  canonical_payload jsonb, payload_checksum bytea, signature bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), issued_at timestamptz, revoked_at timestamptz,
  UNIQUE(tenant_id,idempotency_key), UNIQUE(license_id,license_version), UNIQUE(license_id,id),
  FOREIGN KEY(tenant_id,company_id) REFERENCES organization.companies(tenant_id,id) ON DELETE NO ACTION,
  CHECK ((activation_status='PENDING' AND canonical_payload IS NULL AND signature IS NULL AND issued_at IS NULL AND payload_checksum IS NULL AND revoked_at IS NULL)
    OR (activation_status IN ('ACTIVE','REVOKED') AND canonical_payload IS NOT NULL AND signature IS NOT NULL AND octet_length(signature)=64
      AND payload_checksum IS NOT NULL AND octet_length(payload_checksum)=32 AND issued_at IS NOT NULL
      AND (activation_status='REVOKED')=(revoked_at IS NOT NULL)))
);
CREATE FUNCTION licensing.guard_license_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'License activation history is retained'; END IF;
  IF TG_OP='UPDATE' AND (
    (to_jsonb(NEW)-ARRAY['activation_status','canonical_payload','payload_checksum','signature','issued_at','revoked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['activation_status','canonical_payload','payload_checksum','signature','issued_at','revoked_at'])
    OR NOT ((OLD.activation_status='PENDING' AND NEW.activation_status='ACTIVE')
      OR (OLD.activation_status='ACTIVE' AND NEW.activation_status='REVOKED' AND
        ROW(NEW.canonical_payload,NEW.payload_checksum,NEW.signature,NEW.issued_at) IS NOT DISTINCT FROM
        ROW(OLD.canonical_payload,OLD.payload_checksum,OLD.signature,OLD.issued_at)))
  ) THEN RAISE EXCEPTION 'License activation immutable transition rejected'; END IF;
  IF NOT EXISTS(SELECT 1 FROM licensing.licenses l JOIN identity.device_registry d ON d.tenant_id=l.tenant_id
    JOIN identity.device_credentials c ON c.device_id=d.device_id AND c.installation_id=d.installation_id
      AND c.tenant_id=d.tenant_id AND c.company_id=d.company_id AND c.device_key_id=d.device_key_id AND c.trust_key_id=d.trust_key_id
    WHERE l.id=NEW.license_id AND l.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id AND d.device_id=NEW.device_id
      AND d.installation_id=NEW.installation_id AND c.credential_id=NEW.credential_id)
    THEN RAISE EXCEPTION 'License activation DEV003 binding rejected'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER licensing_activation_guard BEFORE INSERT OR UPDATE OR DELETE ON licensing.license_activations
  FOR EACH ROW EXECUTE FUNCTION licensing.guard_license_activation();
CREATE INDEX licensing_activation_device_idx ON licensing.license_activations(credential_id,activation_status);
CREATE UNIQUE INDEX licensing_activation_nonterminal_uq ON licensing.license_activations(license_id,device_id,installation_id)
  WHERE activation_status IN ('PENDING','ACTIVE');
CREATE TABLE licensing.license_revocations (
  id uuid PRIMARY KEY CHECK(platform.is_uuid_v7(id)),license_id uuid NOT NULL,activation_id uuid NOT NULL UNIQUE,
  sequence bigint NOT NULL CHECK(sequence>0),canonical_payload jsonb NOT NULL,payload_checksum bytea NOT NULL CHECK(octet_length(payload_checksum)=32),
  signature bytea NOT NULL CHECK(octet_length(signature)=64),signing_key_id text NOT NULL REFERENCES licensing.trusted_signing_keys(key_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(license_id,activation_id) REFERENCES licensing.license_activations(license_id,id) ON DELETE NO ACTION,UNIQUE(license_id,sequence)
);
CREATE FUNCTION licensing.guard_license_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'License revocations are append-only'; END IF; RETURN NEW; END $$;
CREATE TRIGGER licensing_revocation_guard BEFORE UPDATE OR DELETE ON licensing.license_revocations FOR EACH ROW EXECUTE FUNCTION licensing.guard_license_revocation();
ALTER TABLE licensing.license_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.license_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY licensing_revocation_central ON licensing.license_revocations TO pos_platform_app,pos_platform_admin USING(true) WITH CHECK(true);
CREATE POLICY licensing_revocation_owner ON licensing.license_revocations TO pos_schema_owner USING(true) WITH CHECK(true);
REVOKE ALL ON licensing.license_revocations FROM PUBLIC,pos_app,pos_worker,pos_reporting;
REVOKE ALL ON FUNCTION licensing.guard_license_revocation() FROM PUBLIC;
GRANT SELECT,INSERT ON licensing.license_revocations TO pos_platform_app;
GRANT SELECT ON licensing.license_revocations TO pos_platform_admin;
ALTER TABLE licensing.license_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.license_activations FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.trusted_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.trusted_signing_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY licensing_activation_central ON licensing.license_activations TO pos_platform_app,pos_platform_admin USING(true) WITH CHECK(true);
CREATE POLICY licensing_key_central ON licensing.trusted_signing_keys TO pos_platform_app,pos_platform_admin USING(true);
CREATE POLICY licensing_activation_owner ON licensing.license_activations TO pos_schema_owner USING(true) WITH CHECK(true);
CREATE POLICY licensing_key_owner ON licensing.trusted_signing_keys TO pos_schema_owner USING(true) WITH CHECK(true);
REVOKE ALL ON licensing.license_activations,licensing.trusted_signing_keys FROM PUBLIC,pos_app,pos_worker,pos_reporting;
REVOKE ALL ON FUNCTION licensing.guard_license_activation() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON licensing.license_activations TO pos_platform_app;
GRANT SELECT ON licensing.license_activations TO pos_platform_admin;
-- Runtime cannot provision keys, change their purpose/status or manufacture trust.
GRANT SELECT ON licensing.trusted_signing_keys TO pos_platform_app,pos_platform_admin;
-- FOR SHARE needs UPDATE privileges; encapsulate that read under the owner
-- instead of letting runtime mutate trust. The lock survives in caller's TX.
CREATE FUNCTION licensing.lock_active_signing_key(p_key_id text,p_environment text)
RETURNS SETOF licensing.trusted_signing_keys LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user<>'pos_platform_app' THEN RAISE EXCEPTION 'Central role required'; END IF;
  RETURN QUERY SELECT k.* FROM licensing.trusted_signing_keys k WHERE k.key_id=p_key_id AND k.environment=p_environment
    AND k.key_purpose='LICENSE' AND k.algorithm_id='Ed25519' AND k.key_status='ACTIVE'
    AND k.valid_from<=clock_timestamp() AND k.valid_until>clock_timestamp() FOR SHARE OF k;
END $$;
REVOKE ALL ON FUNCTION licensing.lock_active_signing_key(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION licensing.lock_active_signing_key(text,text) TO pos_platform_app;
