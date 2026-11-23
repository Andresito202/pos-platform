-- Durable autonomous fulfillment queue for paid subscription licenses.
-- One job per payment. Does not activate devices or invent GLOBAL sessions.
CREATE TABLE subscriptions.license_fulfillment_jobs (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  payment_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  confirmation_source text NOT NULL CHECK (confirmation_source IN (
    'FACTUS_PAY_GET','FACTUS_PAY_WEBHOOK_INBOX','BANK_MANUAL_VERIFIED','PENDING_WEBHOOK'
  )),
  status text NOT NULL CHECK (status IN (
    'PENDING','CONFIRMED','ISSUED','DELIVERY_PENDING','ACTIVATION_PENDING'
  )),
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  claim_expires_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text NULL,
  license_id uuid NULL,
  inbox_observation_id uuid NULL,
  correlation_id uuid NOT NULL CHECK (platform.is_uuid_v7(correlation_id)),
  confirmed_at timestamptz NULL,
  issued_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (payment_id),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) ON DELETE NO ACTION,
  FOREIGN KEY (quote_id) REFERENCES subscriptions.license_quotes(id) ON DELETE NO ACTION,
  CHECK (
    (status = 'PENDING' AND confirmed_at IS NULL AND license_id IS NULL AND issued_at IS NULL)
    OR (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND license_id IS NULL AND issued_at IS NULL)
    OR (status IN ('ISSUED','DELIVERY_PENDING','ACTIVATION_PENDING')
        AND confirmed_at IS NOT NULL AND license_id IS NOT NULL AND issued_at IS NOT NULL)
  ),
  CHECK (
    (claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
    OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
        AND claim_expires_at > claimed_at)
  )
);

CREATE INDEX license_fulfillment_jobs_due_idx
  ON subscriptions.license_fulfillment_jobs(status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','CONFIRMED');

CREATE INDEX license_fulfillment_jobs_claim_idx
  ON subscriptions.license_fulfillment_jobs(claim_token)
  WHERE claim_token IS NOT NULL;

CREATE TRIGGER license_fulfillment_jobs_immutable_guard
  BEFORE UPDATE ON subscriptions.license_fulfillment_jobs
  FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns(
    'status,claim_token,claimed_at,claim_expires_at,attempt_count,next_attempt_at,last_error_code,license_id,inbox_observation_id,confirmation_source,confirmed_at,issued_at,updated_at,version'
  );

ALTER TABLE subscriptions.license_fulfillment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.license_fulfillment_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY license_fulfillment_jobs_central ON subscriptions.license_fulfillment_jobs
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY license_fulfillment_jobs_owner_read ON subscriptions.license_fulfillment_jobs
  FOR SELECT TO pos_schema_owner USING (true);

GRANT SELECT,INSERT ON subscriptions.license_fulfillment_jobs TO pos_platform_app;
GRANT UPDATE (
  status,claim_token,claimed_at,claim_expires_at,attempt_count,next_attempt_at,last_error_code,
  license_id,inbox_observation_id,confirmation_source,confirmed_at,issued_at,updated_at,version
) ON subscriptions.license_fulfillment_jobs TO pos_platform_app;
GRANT SELECT ON subscriptions.license_fulfillment_jobs TO pos_platform_admin;
