CREATE TABLE identity.device_registry (
  device_id uuid PRIMARY KEY CONSTRAINT device_registry_id_v7_ck CHECK (platform.is_uuid_v7(device_id)),
  installation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_key_id text NOT NULL CONSTRAINT device_registry_device_key_id_ck CHECK (btrim(device_key_id) <> ''),
  device_public_key bytea NOT NULL,
  device_public_key_algorithm text NOT NULL CONSTRAINT device_registry_algorithm_ck CHECK (device_public_key_algorithm = 'Ed25519'),
  status text NOT NULL CONSTRAINT device_registry_status_ck CHECK (status IN ('PENDING','ACTIVE','REVOKED','COMPROMISED','RETIRED')),
  trust_key_id text NOT NULL CONSTRAINT device_registry_trust_key_id_ck CHECK (btrim(trust_key_id) <> ''),
  trust_key_purpose text NOT NULL CONSTRAINT device_registry_trust_purpose_ck CHECK (trust_key_purpose = 'DEVICE_TRUST'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT device_registry_version_ck CHECK (version >= 1),
  UNIQUE (installation_id),
  UNIQUE (device_key_id)
);

CREATE TABLE identity.device_credentials (
  credential_id uuid PRIMARY KEY CONSTRAINT device_credentials_id_v7_ck CHECK (platform.is_uuid_v7(credential_id)),
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  installation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_key_id text NOT NULL,
  trust_key_id text NOT NULL,
  key_purpose text NOT NULL CONSTRAINT device_credentials_purpose_ck CHECK (key_purpose = 'DEVICE_TRUST'),
  status text NOT NULL CONSTRAINT device_credentials_status_ck CHECK (status IN ('ACTIVE','REVOKED','COMPROMISED','RETIRED')),
  generation integer NOT NULL CONSTRAINT device_credentials_generation_ck CHECK (generation > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CONSTRAINT device_credentials_expiry_ck CHECK (expires_at > issued_at),
  credential_checksum text NOT NULL CONSTRAINT device_credentials_checksum_ck CHECK (length(credential_checksum) = 64),
  issuer_signature bytea NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT device_credentials_version_ck CHECK (version >= 1),
  UNIQUE (device_id, generation),
  UNIQUE (credential_checksum)
);

CREATE TABLE identity.device_enrollment_activations (
  activation_id uuid PRIMARY KEY CONSTRAINT device_enrollment_activations_id_v7_ck CHECK (platform.is_uuid_v7(activation_id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  activation_checksum text NOT NULL CONSTRAINT device_enrollment_activations_checksum_ck CHECK (length(activation_checksum) = 64),
  status text NOT NULL CONSTRAINT device_enrollment_activations_status_ck CHECK (status IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CONSTRAINT device_enrollment_activations_expiry_ck CHECK (expires_at > issued_at),
  consumed_at timestamptz,
  consumed_credential_id uuid REFERENCES identity.device_credentials(credential_id) ON DELETE NO ACTION,
  UNIQUE (activation_checksum)
);

CREATE TABLE identity.device_authentication_events (
  id uuid PRIMARY KEY CONSTRAINT device_authentication_events_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  credential_id uuid REFERENCES identity.device_credentials(credential_id) ON DELETE NO ACTION,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  result text NOT NULL CONSTRAINT device_authentication_events_result_ck CHECK (result IN ('ACCEPTED','REJECTED')),
  reason_code text NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence_checksum text NOT NULL CONSTRAINT device_authentication_events_checksum_ck CHECK (length(evidence_checksum) = 64)
);

CREATE INDEX device_registry_scope_idx ON identity.device_registry(tenant_id, company_id, status);
CREATE INDEX device_credentials_active_idx ON identity.device_credentials(device_id, status, generation DESC);
CREATE INDEX device_authentication_events_device_idx ON identity.device_authentication_events(device_id, occurred_at DESC);

REVOKE ALL ON identity.device_registry, identity.device_credentials, identity.device_enrollment_activations, identity.device_authentication_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON identity.device_registry, identity.device_credentials, identity.device_enrollment_activations, identity.device_authentication_events TO pos_platform_app;
GRANT SELECT ON identity.device_registry, identity.device_credentials, identity.device_enrollment_activations, identity.device_authentication_events TO pos_platform_admin;
