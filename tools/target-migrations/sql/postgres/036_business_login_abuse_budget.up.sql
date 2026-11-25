-- Durable BUSINESS browser-login abuse budget on the existing security_events ledger.
-- Mirrors GLOBAL_LOGIN_* indexing from 021; does not alter GLOBAL behaviour.
CREATE INDEX IF NOT EXISTS business_login_budget_idx ON identity.security_events(reason_code,evidence_checksum,server_recorded_at)
  WHERE reason_code IN ('BUSINESS_LOGIN_ACCOUNT','BUSINESS_LOGIN_ADDRESS');
