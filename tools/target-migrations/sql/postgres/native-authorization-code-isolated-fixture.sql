-- Isolated test fixture only. DO NOT add to production migration manifests.
-- Use exclusively in a random pos_native_code_test_<16 lowercase hex> database.
CREATE SCHEMA IF NOT EXISTS identity;
CREATE TABLE identity.native_authorization_code_validation (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state text NOT NULL,
  trusted_binding_id text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT native_validation_expiry CHECK (expires_at > issued_at)
);
