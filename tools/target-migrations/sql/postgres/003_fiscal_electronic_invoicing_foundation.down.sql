ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_002_ck CHECK (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument') NOT VALID;
ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_002_ck;
ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_003_ck;

DROP TRIGGER integration_dispatches_fiscal_document_guard ON integrations.integration_dispatches;
DROP TRIGGER provider_capability_declarations_fiscal_downgrade_guard ON integrations.provider_capability_declarations;

REVOKE ALL ON ALL TABLES IN SCHEMA fiscal FROM pos_app,pos_worker,pos_platform_app,pos_platform_admin,pos_reporting;
REVOKE USAGE ON SCHEMA fiscal FROM pos_app,pos_worker,pos_platform_app,pos_platform_admin,pos_reporting;

DROP TABLE fiscal.fiscal_reconciliation_items;
DROP TABLE fiscal.fiscal_incidents;
DROP TABLE fiscal.fiscal_reconciliations;
DROP TABLE fiscal.fiscal_artifacts;
DROP TABLE fiscal.fiscal_submission_attempts;
DROP TABLE fiscal.electronic_documents;
DROP TABLE fiscal.fiscal_emission_configuration_versions;
DROP TABLE fiscal.fiscal_emission_configurations;
DROP TABLE fiscal.fiscal_connections;

DROP FUNCTION fiscal.guard_capability_downgrade();
DROP FUNCTION fiscal.guard_fiscal_dispatch();
DROP FUNCTION fiscal.guard_attempt_number();
DROP FUNCTION fiscal.guard_document_scope();
DROP FUNCTION fiscal.guard_configuration_scope();
DROP FUNCTION fiscal.guard_connection_scope();
DROP FUNCTION fiscal.guard_append_only();
DROP FUNCTION fiscal.guard_configuration_version_state();
DROP FUNCTION fiscal.guard_state_transition();
DROP FUNCTION fiscal.guard_initial_status();
DROP FUNCTION fiscal.guard_allowed_update_columns();
DROP FUNCTION fiscal.safe_external_text(text,integer);

ALTER TABLE integrations.integration_capabilities DROP CONSTRAINT integration_capabilities_fiscal_scope_uq;
DROP SCHEMA fiscal;
