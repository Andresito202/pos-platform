export const DEVICE_TRUST_004_UP_SQL = `
CREATE TABLE identity.device_registry (
  device_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_key_id text NOT NULL,
  device_public_key bytea NOT NULL,
  device_public_key_algorithm text NOT NULL CHECK (device_public_key_algorithm = 'Ed25519'),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED','COMPROMISED','RETIRED')),
  trust_key_id text NOT NULL,
  trust_key_purpose text NOT NULL CHECK (trust_key_purpose = 'DEVICE_TRUST'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (installation_id),
  UNIQUE (device_key_id)
);

CREATE TABLE identity.device_credentials (
  credential_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) NO ACTION,
  installation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_key_id text NOT NULL,
  trust_key_id text NOT NULL,
  key_purpose text NOT NULL CHECK (key_purpose = 'DEVICE_TRUST'),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED','COMPROMISED','RETIRED')),
  generation integer NOT NULL CHECK (generation > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  credential_checksum text NOT NULL CHECK (length(credential_checksum) = 64),
  issuer_signature bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_reason text,
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (device_id, generation),
  UNIQUE (credential_checksum)
);

CREATE TABLE identity.device_enrollment_activations (
  activation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  activation_checksum text NOT NULL CHECK (length(activation_checksum) = 64),
  status text NOT NULL CHECK (status IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  consumed_at timestamptz,
  consumed_credential_id uuid REFERENCES identity.device_credentials(credential_id) NO ACTION,
  UNIQUE (activation_checksum)
);

CREATE TABLE identity.device_authentication_events (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) NO ACTION,
  credential_id uuid REFERENCES identity.device_credentials(credential_id) NO ACTION,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('ACCEPTED','REJECTED')),
  reason_code text NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence_checksum text NOT NULL CHECK (length(evidence_checksum) = 64)
);

CREATE INDEX device_registry_scope_idx ON identity.device_registry(tenant_id, company_id, status);
CREATE INDEX device_credentials_active_idx ON identity.device_credentials(device_id, status, generation DESC);
CREATE INDEX device_authentication_events_device_idx ON identity.device_authentication_events(device_id, occurred_at DESC);
`.trim();

export const DEVICE_TRUST_004_DOWN_SQL = `
DROP TABLE IF EXISTS identity.device_authentication_events;
DROP TABLE IF EXISTS identity.device_enrollment_activations;
DROP TABLE IF EXISTS identity.device_credentials;
DROP TABLE IF EXISTS identity.device_registry;
`.trim();
