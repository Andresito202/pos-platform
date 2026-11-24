DROP POLICY IF EXISTS commercial_provisioning_receipts_central ON licensing.commercial_provisioning_receipts;
DROP POLICY IF EXISTS commercial_trial_grants_central ON licensing.commercial_trial_grants;
DROP POLICY IF EXISTS commercial_bridge_jtis_central ON identity.commercial_bridge_jtis;
DROP POLICY IF EXISTS commercial_bridge_sessions_central ON identity.commercial_bridge_sessions;

DROP TABLE IF EXISTS licensing.commercial_provisioning_receipts;
DROP TABLE IF EXISTS licensing.commercial_trial_grants;

DROP TRIGGER IF EXISTS commercial_bridge_jti_guard ON identity.commercial_bridge_jtis;
DROP FUNCTION IF EXISTS identity.guard_commercial_bridge_jti();
DROP TABLE IF EXISTS identity.commercial_bridge_jtis;
DROP TABLE IF EXISTS identity.commercial_bridge_sessions;
