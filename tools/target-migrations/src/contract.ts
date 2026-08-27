import { FISCAL_003_FUNCTION_DEFINITION_SQL, FISCAL_003_REQUIRED_FUNCTIONS } from "./postgres-003-functions.js";
import { FISCAL_003_EXTERNAL_FENCE_CONTRACTS } from "./postgres-003-external-contracts.js";
import {
  FISCAL_003_DISPATCH_CLASS_TRANSITION,
  FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION,
  FISCAL_003_RECEIPT_INGRESS_GRANT_TRANSITION,
  FISCAL_003_DISPATCH_INGRESS_GRANT_TRANSITION,
  FISCAL_003_LEGACY_GRANT_TRANSITIONS,
} from "./postgres-003-transitions.js";
import {
  FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS,
  FISCAL_003_EXACT_GUARD_DEFINITIONS,
  FISCAL_003_EXACT_INDEX_DEFINITIONS,
  FISCAL_003_EXACT_POLICY_DEFINITIONS,
  FISCAL_003_TABLE_BLUEPRINT_SQL,
} from "./postgres-003-blueprint.js";
import { FISCAL_003_CATALOG_DEFINITIONS } from "./postgres-003-catalog.js";

export const TARGET_SCHEMAS = [
  "identity",
  "tenancy",
  "organization",
  "authorization",
  "sync",
  "audit",
] as const;

export const POSTGRES_TABLE_COLUMNS = {
  "platform.target_migration_executions": ["execution_id","migration_id","dialect","manifest_version","checksum","status","started_at","body_committed_at","smoke_verified_at","applied_at","rolled_back_at","finished_at","runner_version","error_code"],
  "identity.users": ["id","email","email_normalized","phone","phone_normalized","full_name","status","created_at","updated_at","version"],
  "tenancy.tenants": ["id","name","code","code_normalized","status","created_at","updated_at","version"],
  "organization.companies": ["id","tenant_id","legal_name","trade_name","tax_id","tax_id_normalized","email","phone","phone_normalized","timezone","currency_code","status","created_at","updated_at","version"],
  "organization.branches": ["id","tenant_id","company_id","name","code","code_normalized","address","city","latitude","longitude","timezone","status","created_at","updated_at","version"],
  "tenancy.tenant_memberships": ["id","tenant_id","user_id","membership_type","status","is_primary","created_by_actor_type","created_by_actor_id","created_at","activated_at","suspended_at","revoked_at","version"],
  "identity.user_credentials": ["id","user_id","credential_type","verifier","status","failed_attempt_count","locked_until","created_at","rotated_at","last_used_at","revoked_at","retained_until","version"],
  "identity.mfa_factors": ["id","user_id","factor_type","secret_reference","status","enrolled_at","verified_at","last_used_at","revoked_at","retained_until","version"],
  "authorization.roles": ["id","code","name","scope_type","version","status","created_at","retired_at"],
  "authorization.permissions": ["id","code","module","description","status","created_at","retired_at"],
  "authorization.role_permission_grants": ["id","role_id","permission_id","grant_version","status","valid_from","valid_until","created_at","retired_at"],
  "authorization.authorization_policy_versions": ["id","code","version","ruleset_checksum","status","effective_from","effective_until","created_at","retired_at"],
  "authorization.user_role_assignments": ["id","tenant_id","tenant_membership_id","role_id","company_id","branch_id","status","valid_from","valid_until","created_at","created_by_actor_type","created_by_actor_id","revoked_at","version"],
  "identity.sessions": ["id","user_id","tenant_id","tenant_membership_id","device_id","authenticated_at","expires_at","last_reauthenticated_at","mfa_status","authorization_policy_version_id","offline_valid_until","revoked_at","revoked_by_actor_type","revoked_by_actor_id","revocation_reason","created_at","version"],
  "identity.session_refresh_tokens": ["id","session_id","token_family_id","parent_token_id","token_hash","issued_at","expires_at","consumed_at","replacement_token_id","revoked_at","revocation_reason","reuse_detected_at","retained_until"],
  "identity.security_events": ["id","user_id","session_id","tenant_id","device_id","event_code","result","reason_code","ip_address","evidence_checksum","correlation_id","occurred_at","server_recorded_at"],
  "tenancy.onboarding_operations": ["id","actor_type","actor_id","idempotency_key","request_checksum","correlation_id","tenant_id","company_id","branch_id","owner_user_id","tenant_membership_id","owner_membership_type","status","reason_code","license_reference","requested_plan","effective_plan","pricing_policy_version","tax_policy_version","rounding_policy_version","authorization_policy_version_id","required_action","created_at","updated_at","completed_at","cancelled_at","version"],
  "sync.sync_operations": ["id","tenant_id","company_id","branch_id","source_kind","device_id","installation_id","session_id","actor_type","actor_id","aggregate_type","aggregate_id","operation_type","idempotency_key","expected_version","authority_policy","parent_operation_id","causation_id","correlation_id","schema_version","payload","payload_checksum","sync_status","occurred_at_local","recorded_at_local","received_at_server","committed_at_server","version"],
  "sync.outbox_entries": ["id","tenant_id","operation_id","device_id","local_sequence","operation_type","schema_version","payload_checksum","correlation_id","causation_id","sync_status","created_at","available_at","attempt_count","last_attempt_at","next_attempt_at","last_error_code","acknowledged_at","updated_at","version"],
  "audit.audit_events": ["id","tenant_id","company_id","branch_id","actor_type","actor_id","session_id","device_id","action_code","resource_type","resource_reference_kind","resource_id","operation_id","correlation_id","causation_id","schema_version","reported_at","server_recorded_at","result","reason_code","reason_detail","previous_value","new_value","reviewer_actor_type","reviewer_actor_id","approver_actor_type","approver_actor_id","evidence_reference","evidence_checksum","payload_checksum"],
} as const;

export const RLS_TABLES = [
  "tenancy.tenants",
  "organization.companies",
  "organization.branches",
  "tenancy.tenant_memberships",
  "authorization.user_role_assignments",
  "identity.sessions",
  "identity.security_events",
  "sync.sync_operations",
  "sync.outbox_entries",
  "audit.audit_events",
] as const;

export const REQUIRED_POLICIES = [
  "tenants_tenant_isolation",
  "companies_tenant_isolation",
  "branches_tenant_isolation",
  "tenant_memberships_tenant_isolation",
  "user_role_assignments_tenant_isolation",
  "security_events_tenant_isolation",
  "sync_operations_tenant_isolation",
  "outbox_entries_tenant_isolation",
  "audit_events_tenant_isolation",
  "sessions_tenant_context",
  "sessions_identity_select",
  "sessions_identity_insert",
  "sessions_identity_update",
  "security_events_platform_context",
  "audit_events_platform_context",
] as const;

export const PROHIBITED_TABLE_NAMES = [
  "products","product_variants","barcodes","sales","sale_items","payments",
  "inventory_movements","stock_balances","price_lists","tax_rules","electronic_documents",
  "devices","device_keys","licenses","license_activations","inbox_entries","sync_checkpoints",
  "sync_conflicts","sync_reviews","sync_dead_letters","kysely_migration","kysely_migration_lock",
] as const;

export interface MigrationDescriptor {
  migrationId: string;
  manifestVersion: number;
  dependencies: readonly string[];
  upArtifact: string;
  downArtifact: string;
  checksum: "DERIVED_FROM_UP_ARTIFACT";
  ownedSchemas: readonly string[];
  ownedTables: readonly string[];
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT" | readonly string[];
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT" | readonly string[];
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT" | readonly string[];
  requiredExtensions: readonly string[];
  expectedLedgerState: "APPLIED";
}

export const POSTGRES_001_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "001_central_foundation",
  manifestVersion: 1,
  dependencies: [],
  upArtifact: "postgres/001_central_foundation.up.sql",
  downArtifact: "postgres/001_central_foundation.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: TARGET_SCHEMAS,
  ownedTables: Object.keys(POSTGRES_TABLE_COLUMNS).filter((name) => !name.startsWith("platform.")),
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};

export const INTEGRATION_TABLES = [
  "provider_registry",
  "provider_adapter_versions",
  "provider_capability_declarations",
  "provider_platform_configurations",
  "external_integrations",
  "integration_credential_bindings",
  "resource_ownership_policies",
  "integration_capabilities",
  "integration_discovery_runs",
  "integration_discovery_items",
  "external_reference_mappings",
  "integration_dispatches",
  "integration_dispatch_attempts",
  "external_webhook_receipts",
  "provider_rate_limit_policies",
  "provider_verification_evidence",
] as const;

export const INTEGRATION_RLS_TABLES = INTEGRATION_TABLES.slice(4) as readonly string[];

export const POSTGRES_002_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "002_external_integrations_foundation",
  manifestVersion: 1,
  dependencies: [POSTGRES_001_DESCRIPTOR.migrationId],
  upArtifact: "postgres/002_external_integrations_foundation.up.sql",
  downArtifact: "postgres/002_external_integrations_foundation.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["integrations"],
  ownedTables: INTEGRATION_TABLES.map((name) => `integrations.${name}`),
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: ["btree_gist"],
  expectedLedgerState: "APPLIED",
};


export const FISCAL_TABLES = [
  "fiscal_connections",
  "fiscal_emission_configurations",
  "fiscal_emission_configuration_versions",
  "electronic_documents",
  "fiscal_document_preparations",
  "fiscal_submission_attempts",
  "fiscal_artifacts",
  "fiscal_reconciliations",
  "fiscal_incidents",
  "fiscal_reconciliation_items",
] as const;

export const FISCAL_RLS_TABLES = FISCAL_TABLES;

export const FISCAL_003_TABLE_COLUMNS = {
  "fiscal.fiscal_connections": [
    "id","tenant_id","company_id","external_integration_id","electronic_invoicing_capability_id",
    "capability_code","valid_from","valid_until","created_at","updated_at","version",
  ],
  "fiscal.fiscal_emission_configurations": [
    "id","tenant_id","company_id","branch_id","scope_type","fiscal_connection_id",
    "external_integration_id","document_type","created_at",
  ],
  "fiscal.fiscal_emission_configuration_versions": [
    "id","tenant_id","company_id","branch_id","scope_type","fiscal_connection_id",
    "external_integration_id","fiscal_emission_configuration_id","document_type","version_number",
    "status","issuer_tax_id_normalized_snapshot","issuer_legal_name_snapshot","authorization_reference",
    "numbering_policy_code","prefix","number_range_start","number_range_end","next_number_value",
    "numbering_exhausted_at","provider_numbering_reference","certificate_reference",
    "contingency_policy_reference","fiscal_capabilities_snapshot_reference",
    "fiscal_capabilities_snapshot_checksum","configuration_schema_version","configuration_checksum",
    "valid_from","valid_until","published_at","supersedes_version_id","created_by_actor_id",
    "published_by_actor_id","created_at","updated_at","row_version",
  ],
  "fiscal.electronic_documents": [
    "id","tenant_id","company_id","branch_id","source_type","source_id","document_type",
    "logical_operation_key","status","internal_reference","preparation_generation",
    "authority_reference","legal_identifier","authority_status_raw","uncertainty_reason",
    "original_electronic_document_id","issued_at","accepted_at","rejected_at",
    "last_reconciled_at","created_at","updated_at","version",
  ],
  "fiscal.fiscal_document_preparations": [
    "id","tenant_id","company_id","branch_id","electronic_document_id","document_type",
    "preparation_generation","supersedes_preparation_id","preparation_state","external_integration_id",
    "fiscal_connection_id","fiscal_emission_configuration_id","emission_configuration_version_id",
    "source_version","correction_source_reference","currency_code","subtotal_amount","discount_amount",
    "tax_amount","total_amount","tax_snapshot_reference","tax_snapshot_checksum",
    "fiscal_emission_snapshot_reference","fiscal_emission_snapshot_checksum",
    "canonical_payload_version","canonical_payload_checksum","numbering_mode","numbering_state",
    "prefix","number","number_reserved_at","number_consumed_at","number_burned_at",
    "numbering_resolution_reason","provider_document_id","provider_reference","provider_status_raw",
    "created_by_actor_id","frozen_at","cancelled_at","cancelled_by_actor_id","cancellation_reason",
    "created_at","updated_at","version",
  ],
  "fiscal.fiscal_submission_attempts": [
    "id","tenant_id","company_id","external_integration_id","fiscal_connection_id",
    "electronic_document_id","fiscal_document_preparation_id","preparation_generation",
    "integration_dispatch_id","credential_binding_id","credential_binding_generation",
    "dispatch_class","operation_type","attempt_number","status",
    "transport_status","normalized_result","request_id","idempotency_key","request_checksum",
    "provider_operation_id","provider_correlation_reference","provider_response_reference",
    "http_status","provider_code_raw","retry_classification","error_code","retry_after_at",
    "started_at","completed_at","correlation_id","causation_id","created_at","version",
  ],
  "fiscal.fiscal_artifacts": [
    "id","tenant_id","company_id","external_integration_id","electronic_document_id",
    "fiscal_document_preparation_id","preparation_generation","fiscal_submission_attempt_id",
    "artifact_type","media_type","storage_reference","checksum_algorithm","checksum","size_bytes",
    "provider_reference","authority_reference","retention_policy_reference","immutable_evidence","created_at",
  ],
  "fiscal.fiscal_reconciliations": [
    "id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id",
    "scope_type","electronic_document_id","preparation_generation","scope_snapshot_reference",
    "scope_snapshot_checksum","status","expected_state_snapshot_reference","observed_state_snapshot_reference",
    "provider_evidence_reference","authority_evidence_reference","discrepancy_summary_code",
    "started_by_actor_id","reviewed_by_actor_id","closed_by_actor_id","resolution_reason",
    "started_at","closed_at","correlation_id","causation_id","created_at","updated_at","version",
  ],
  "fiscal.fiscal_incidents": [
    "id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id",
    "electronic_document_id","preparation_generation","fiscal_submission_attempt_id",
    "fiscal_reconciliation_id","incident_type","severity","status","summary_code","evidence_reference",
    "assigned_reviewer_id","resolution_type","resolution_reason","resolved_by_actor_id","resolved_at",
    "archived_at","correlation_id","causation_id","created_at","updated_at","version",
  ],
  "fiscal.fiscal_reconciliation_items": [
    "id","tenant_id","company_id","external_integration_id","fiscal_connection_id",
    "fiscal_reconciliation_id","electronic_document_id","fiscal_document_preparation_id",
    "preparation_generation","expected_state_reference","observed_state_reference","evidence_checksum",
    "discrepancy_code","result_code","evidence_reference","fiscal_incident_id","created_at",
  ],
} as const;

export const FISCAL_003_ALTERED_TABLES = [
  "integrations.provider_capability_declarations",
  "integrations.integration_capabilities",
  "integrations.integration_credential_bindings",
  "integrations.integration_dispatches",
  "integrations.external_webhook_receipts",
] as const;

export const FISCAL_003_INTEGRATION_EXTENSION_COLUMNS = {
  "integrations.integration_dispatches": [
    "fiscal_document_preparation_id",
    "fiscal_preparation_generation",
    "fiscal_request_semantic_version",
    "fiscal_request_semantic_checksum",
  ],
  "integrations.external_webhook_receipts": [
    "fiscal_electronic_document_id",
    "fiscal_document_preparation_id",
    "fiscal_preparation_generation",
    "fiscal_integration_dispatch_id",
    "fiscal_correlated_at",
  ],
} as const;

export const FISCAL_003_TABLE_CONSTRAINTS = {
  "fiscal.fiscal_connections": [
    "fiscal_connections_id_v7_ck","fiscal_connections_tenant_id_id_uq",
    "fiscal_connections_tenant_company_id_id_uq","fiscal_connections_tenant_company_integration_id_uq",
    "fiscal_connections_company_fk","fiscal_connections_integration_fk","fiscal_connections_capability_fk",
    "fiscal_connections_capability_ck","fiscal_connections_validity_ck","fiscal_connections_version_ck",
    "fiscal_connections_company_validity_excl",
  ],
  "fiscal.fiscal_emission_configurations": [
    "fiscal_emission_configurations_id_v7_ck","fiscal_emission_configurations_tenant_id_id_uq",
    "fiscal_emission_configurations_tenant_company_id_id_uq","fiscal_emission_configurations_scope_uq",
    "fiscal_emission_configurations_connection_fk","fiscal_emission_configurations_branch_fk",
    "fiscal_emission_configurations_scope_ck","fiscal_emission_configurations_document_type_ck",
  ],
  "fiscal.fiscal_emission_configuration_versions": [
    "fiscal_emission_configuration_versions_id_v7_ck",
    "fiscal_emission_configuration_versions_tenant_id_id_uq",
    "fiscal_emission_configuration_versions_tenant_company_id_id_uq",
    "fiscal_emission_configuration_versions_scope_uq",
    "fiscal_emission_configuration_versions_number_uq",
    "fiscal_emission_configuration_versions_configuration_fk",
    "fiscal_emission_configuration_versions_branch_fk",
    "fiscal_emission_configuration_versions_created_by_fk",
    "fiscal_emission_configuration_versions_published_by_fk",
    "fiscal_emission_configuration_versions_scope_ck",
    "fiscal_emission_configuration_versions_status_ck",
    "fiscal_emission_configuration_versions_numbering_ck",
    "fiscal_emission_configuration_versions_checksum_ck",
    "fiscal_emission_configuration_versions_publication_ck",
    "fiscal_emission_configuration_versions_validity_ck",
    "fiscal_emission_configuration_versions_supersedes_fk",
    "fiscal_emission_configuration_versions_published_validity_excl",
  ],
  "fiscal.electronic_documents": [
    "electronic_documents_id_v7_ck","electronic_documents_tenant_id_id_uq",
    "electronic_documents_tenant_company_id_id_uq","electronic_documents_document_type_scope_uq",
    "electronic_documents_logical_operation_uq","electronic_documents_branch_fk",
    "electronic_documents_original_fk","electronic_documents_status_ck",
    "electronic_documents_document_type_ck","electronic_documents_generation_ck",
    "electronic_documents_original_type_ck","electronic_documents_authority_identity_ck",
    "electronic_documents_timestamps_ck","electronic_documents_version_ck",
  ],
  "fiscal.fiscal_document_preparations": [
    "fiscal_document_preparations_id_v7_ck","fiscal_document_preparations_tenant_id_id_uq",
    "fiscal_document_preparations_tenant_company_id_id_uq","fiscal_document_preparations_document_id_uq",
    "fiscal_document_preparations_generation_uq","fiscal_document_preparations_dispatch_scope_uq",
    "fiscal_document_preparations_attempt_scope_uq","fiscal_document_preparations_document_fk",
    "fiscal_document_preparations_branch_fk","fiscal_document_preparations_connection_fk",
    "fiscal_document_preparations_configuration_version_fk","fiscal_document_preparations_supersedes_fk",
    "fiscal_document_preparations_created_by_fk","fiscal_document_preparations_cancelled_by_fk",
    "fiscal_document_preparations_state_ck","fiscal_document_preparations_generation_ck",
    "fiscal_document_preparations_checksum_ck","fiscal_document_preparations_amounts_ck",
    "fiscal_document_preparations_numbering_ck","fiscal_document_preparations_lifecycle_ck",
    "fiscal_document_preparations_provider_identity_ck","fiscal_document_preparations_version_ck",
  ],
  "fiscal.fiscal_submission_attempts": [
    "fiscal_submission_attempts_id_v7_ck","fiscal_submission_attempts_tenant_id_id_uq",
    "fiscal_submission_attempts_tenant_company_id_id_uq","fiscal_submission_attempts_document_scope_uq",
    "fiscal_submission_attempts_connection_scope_uq","fiscal_submission_attempts_dispatch_history_uq",
    "fiscal_submission_attempts_document_history_uq","fiscal_submission_attempts_preparation_fk",
    "fiscal_submission_attempts_connection_fk","fiscal_submission_attempts_dispatch_fk",
    "fiscal_submission_attempts_credential_binding_fk","fiscal_submission_attempts_credential_generation_ck",
    "fiscal_submission_attempts_class_ck","fiscal_submission_attempts_operation_type_ck",
    "fiscal_submission_attempts_status_ck","fiscal_submission_attempts_result_ck","fiscal_submission_attempts_transport_ck",
    "fiscal_submission_attempts_retry_ck","fiscal_submission_attempts_checksum_ck",
    "fiscal_submission_attempts_values_ck","fiscal_submission_attempts_timestamps_ck",
  ],
  "fiscal.fiscal_artifacts": [
    "fiscal_artifacts_id_v7_ck","fiscal_artifacts_tenant_id_id_uq",
    "fiscal_artifacts_tenant_company_id_id_uq","fiscal_artifacts_identity_uq",
    "fiscal_artifacts_preparation_fk","fiscal_artifacts_attempt_fk",
    "fiscal_artifacts_type_ck","fiscal_artifacts_checksum_ck","fiscal_artifacts_values_ck",
  ],
  "fiscal.fiscal_reconciliations": [
    "fiscal_reconciliations_id_v7_ck","fiscal_reconciliations_tenant_id_id_uq",
    "fiscal_reconciliations_tenant_company_id_id_uq","fiscal_reconciliations_scope_uq",
    "fiscal_reconciliations_connection_fk","fiscal_reconciliations_branch_fk",
    "fiscal_reconciliations_preparation_generation_fk","fiscal_reconciliations_started_by_fk",
    "fiscal_reconciliations_reviewed_by_fk","fiscal_reconciliations_closed_by_fk",
    "fiscal_reconciliations_scope_ck","fiscal_reconciliations_status_ck",
    "fiscal_reconciliations_checksum_ck","fiscal_reconciliations_lifecycle_ck",
    "fiscal_reconciliations_version_ck",
  ],
  "fiscal.fiscal_incidents": [
    "fiscal_incidents_id_v7_ck","fiscal_incidents_tenant_id_id_uq",
    "fiscal_incidents_tenant_company_id_id_uq","fiscal_incidents_scope_uq",
    "fiscal_incidents_connection_fk","fiscal_incidents_branch_fk","fiscal_incidents_document_fk",
    "fiscal_incidents_preparation_generation_fk","fiscal_incidents_attempt_fk",
    "fiscal_incidents_reconciliation_fk","fiscal_incidents_reviewer_fk","fiscal_incidents_resolved_by_fk",
    "fiscal_incidents_status_ck","fiscal_incidents_resolution_ck","fiscal_incidents_lifecycle_ck",
    "fiscal_incidents_version_ck",
  ],
  "fiscal.fiscal_reconciliation_items": [
    "fiscal_reconciliation_items_id_v7_ck","fiscal_reconciliation_items_tenant_id_id_uq",
    "fiscal_reconciliation_items_tenant_company_id_id_uq","fiscal_reconciliation_items_identity_uq",
    "fiscal_reconciliation_items_reconciliation_fk","fiscal_reconciliation_items_preparation_fk",
    "fiscal_reconciliation_items_incident_fk","fiscal_reconciliation_items_checksum_ck",
    "fiscal_reconciliation_items_result_ck",
  ],
} as const;

export const FISCAL_003_EXTENSION_CONSTRAINTS = [
  "integration_capabilities_fiscal_scope_uq",
  "integration_credential_bindings_attempt_scope_uq",
  "integration_dispatches_fiscal_preparation_ck",
  "integration_dispatches_fiscal_semantic_request_ck",
  "integration_dispatches_fiscal_preparation_fk",
  "integration_dispatches_dispatch_class_003_ck",
  "external_webhook_receipts_fiscal_correlation_ck",
  "external_webhook_receipts_fiscal_dispatch_fk",
  "external_webhook_receipts_fiscal_document_fk",
  "external_webhook_receipts_fiscal_preparation_fk",
] as const;

export const FISCAL_003_REQUIRED_INDEXES = [
  "fiscal_emission_configurations_company_scope_uq",
  "fiscal_emission_configurations_branch_scope_uq",
  "electronic_documents_legal_identifier_uq",
  "fiscal_document_preparations_legal_number_uq",
  "fiscal_document_preparations_provider_document_uq",
  "integration_dispatches_one_fiscal_per_preparation_uq",
  "fiscal_submission_attempts_one_in_progress_uq",
  "fiscal_connections_scope_effective_idx",
  "fiscal_connections_capability_fk_idx",
  "fiscal_emission_configurations_branch_fk_idx",
  "fiscal_emission_configuration_versions_lookup_idx",
  "fiscal_emission_configuration_versions_supersedes_idx",
  "electronic_documents_source_idx",
  "electronic_documents_work_idx",
  "electronic_documents_uncertain_idx",
  "electronic_documents_original_idx",
  "fiscal_document_preparations_document_generation_idx",
  "fiscal_document_preparations_integration_connection_idx",
  "fiscal_document_preparations_supersedes_idx",
  "fiscal_document_preparations_created_by_idx",
  "fiscal_document_preparations_cancelled_by_idx",
  "fiscal_submission_attempts_dispatch_fk_idx",
  "fiscal_submission_attempts_document_generation_idx",
  "fiscal_submission_attempts_unknown_idx",
  "fiscal_submission_attempts_provider_operation_idx",
  "fiscal_artifacts_document_generation_idx",
  "fiscal_artifacts_attempt_fk_idx",
  "fiscal_reconciliations_work_idx",
  "fiscal_reconciliations_connection_idx",
  "fiscal_reconciliations_document_generation_idx",
  "fiscal_incidents_open_idx",
  "fiscal_incidents_document_generation_idx",
  "fiscal_incidents_attempt_idx",
  "fiscal_incidents_reconciliation_idx",
  "fiscal_reconciliation_items_document_generation_idx",
  "fiscal_reconciliation_items_incident_idx",
  "fiscal_reconciliation_items_preparation_idx",
  "integration_dispatches_fiscal_preparation_idx",
  "external_webhook_receipts_fiscal_correlation_idx",
  "external_webhook_receipts_fiscal_dispatch_fk_idx",
] as const;

export const FISCAL_003_REQUIRED_GUARDS = [
  "fiscal_connections_scope_guard",
  "fiscal_connections_capability_guard",
  "fiscal_emission_configurations_scope_guard",
  "fiscal_emission_configuration_versions_update_guard",
  "fiscal_emission_configuration_versions_state_guard",
  "fiscal_emission_configuration_versions_numbering_guard",
  "electronic_documents_insert_guard",
  "electronic_documents_update_guard",
  "electronic_documents_state_guard",
  "electronic_documents_evidence_guard",
  "electronic_documents_reprepare_guard",
  "electronic_documents_current_preparation_guard",
  "fiscal_document_preparations_insert_guard",
  "fiscal_document_preparations_update_guard",
  "fiscal_document_preparations_state_guard",
  "fiscal_document_preparations_numbering_guard",
  "fiscal_document_preparations_late_evidence_guard",
  "fiscal_document_preparations_current_generation_guard",
  "fiscal_submission_attempts_insert_guard",
  "fiscal_submission_attempts_update_guard",
  "fiscal_submission_attempts_state_guard",
  "fiscal_submission_attempts_number_guard",
  "fiscal_submission_attempts_root_guard",
  "fiscal_artifacts_immutable_guard",
  "fiscal_reconciliations_insert_guard",
  "fiscal_reconciliations_update_guard",
  "fiscal_reconciliations_state_guard",
  "fiscal_incidents_insert_guard",
  "fiscal_incidents_update_guard",
  "fiscal_incidents_state_guard",
  "fiscal_reconciliation_items_immutable_guard",
  "integration_dispatches_fiscal_preparation_guard",
  "external_webhook_receipts_update_guard_003",
  "external_webhook_receipts_fiscal_correlation_guard",
  "provider_capability_declarations_fiscal_downgrade_guard",
] as const;

export const FISCAL_003_REQUIRED_POLICIES = [
  "fiscal_connections_tenant_isolation",
  "fiscal_emission_configurations_tenant_isolation",
  "fiscal_emission_configuration_versions_app_tenant_isolation",
  "fiscal_emission_configuration_versions_platform_tenant_select",
  "fiscal_emission_configuration_versions_worker_published_history",
  "fiscal_emission_configuration_versions_worker_numbering_update",
  "electronic_documents_tenant_isolation",
  "fiscal_document_preparations_app_tenant_isolation",
  "fiscal_document_preparations_platform_tenant_select",
  "fiscal_document_preparations_worker_frozen",
  "fiscal_document_preparations_worker_historical_evidence",
  "fiscal_submission_attempts_tenant_isolation",
  "fiscal_artifacts_tenant_isolation",
  "fiscal_reconciliations_tenant_isolation",
  "fiscal_incidents_tenant_isolation",
  "fiscal_reconciliation_items_tenant_isolation",
] as const;

const PREPARATION_ALL = FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_document_preparations"];
const PREPARATION_INSERT_APP = [
  "id","tenant_id","company_id","branch_id","electronic_document_id","document_type",
  "preparation_generation","supersedes_preparation_id","preparation_state","external_integration_id",
  "fiscal_connection_id","fiscal_emission_configuration_id","emission_configuration_version_id",
  "source_version","correction_source_reference","currency_code","subtotal_amount","discount_amount",
  "tax_amount","total_amount","tax_snapshot_reference","tax_snapshot_checksum",
  "fiscal_emission_snapshot_reference","fiscal_emission_snapshot_checksum","canonical_payload_version",
  "canonical_payload_checksum","numbering_mode","numbering_state","prefix","number","number_reserved_at",
  "created_by_actor_id","created_at","updated_at","version",
] as const;
const PREPARATION_UPDATE_APP = [
  "source_version","correction_source_reference","currency_code","subtotal_amount","discount_amount",
  "tax_amount","total_amount","tax_snapshot_reference","tax_snapshot_checksum",
  "fiscal_emission_snapshot_reference","fiscal_emission_snapshot_checksum","canonical_payload_version",
  "canonical_payload_checksum","numbering_state","prefix","number","number_reserved_at",
  "number_consumed_at","number_burned_at","numbering_resolution_reason","preparation_state","frozen_at",
  "cancelled_at","cancelled_by_actor_id","cancellation_reason","updated_at","version",
] as const;
const PREPARATION_UPDATE_WORKER = [
  "numbering_state","prefix","number","number_reserved_at","number_consumed_at","number_burned_at",
  "numbering_resolution_reason","provider_document_id","provider_reference","provider_status_raw",
  "updated_at","version",
] as const;
const PREPARATION_PLATFORM_SELECT = PREPARATION_ALL.filter((column) => ![
  "tax_snapshot_reference","tax_snapshot_checksum","fiscal_emission_snapshot_reference",
  "fiscal_emission_snapshot_checksum","canonical_payload_checksum",
].includes(column));

export const FISCAL_003_GRANT_MATRIX = {
  "fiscal.fiscal_connections": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_connections"], insert: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_connections"], update: ["valid_until","updated_at","version"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_connections"], insert: [], update: ["id"] },
    pos_platform_app: { select: ["id","tenant_id","company_id","external_integration_id","capability_code","valid_from","valid_until","created_at","updated_at","version"], insert: [], update: [] },
    pos_platform_admin: { select: ["id","tenant_id","company_id","external_integration_id","capability_code","valid_from","valid_until","created_at","updated_at","version"], insert: [], update: [] },
  },
  "fiscal.fiscal_emission_configurations": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configurations"], insert: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configurations"], update: ["id"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configurations"], insert: [], update: ["id"] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configurations"], insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configurations"], insert: [], update: [] },
  },
  "fiscal.fiscal_emission_configuration_versions": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configuration_versions"].filter((c)=>c!=="certificate_reference"), insert: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configuration_versions"].filter((c)=>!["numbering_exhausted_at","published_at","published_by_actor_id"].includes(c)), update: ["issuer_tax_id_normalized_snapshot","issuer_legal_name_snapshot","authorization_reference","numbering_policy_code","prefix","number_range_start","number_range_end","next_number_value","numbering_exhausted_at","provider_numbering_reference","certificate_reference","contingency_policy_reference","fiscal_capabilities_snapshot_reference","fiscal_capabilities_snapshot_checksum","configuration_schema_version","configuration_checksum","valid_from","valid_until","status","published_at","published_by_actor_id","updated_at","row_version"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configuration_versions"], insert: [], update: ["next_number_value","numbering_exhausted_at","updated_at","row_version"] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configuration_versions"].filter((c)=>!["certificate_reference","fiscal_capabilities_snapshot_reference","fiscal_capabilities_snapshot_checksum","configuration_checksum"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_emission_configuration_versions"].filter((c)=>!["certificate_reference","fiscal_capabilities_snapshot_reference","fiscal_capabilities_snapshot_checksum","configuration_checksum"].includes(c)), insert: [], update: [] },
  },
  "fiscal.electronic_documents": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"], insert: ["id","tenant_id","company_id","branch_id","source_type","source_id","document_type","logical_operation_key","status","internal_reference","preparation_generation","original_electronic_document_id","created_at","updated_at","version"], update: ["status","internal_reference","preparation_generation","updated_at","version"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"], insert: [], update: ["status","authority_reference","legal_identifier","authority_status_raw","uncertainty_reason","issued_at","accepted_at","rejected_at","last_reconciled_at","updated_at","version"] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"].filter((c)=>!["authority_status_raw","uncertainty_reason"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"].filter((c)=>!["authority_status_raw","uncertainty_reason"].includes(c)), insert: [], update: [] },
  },
  "fiscal.fiscal_document_preparations": {
    pos_app: { select: PREPARATION_ALL, insert: PREPARATION_INSERT_APP, update: PREPARATION_UPDATE_APP },
    pos_worker: { select: PREPARATION_ALL, insert: [], update: PREPARATION_UPDATE_WORKER },
    pos_platform_app: { select: PREPARATION_PLATFORM_SELECT, insert: [], update: [] },
    pos_platform_admin: { select: PREPARATION_PLATFORM_SELECT, insert: [], update: [] },
  },
  "fiscal.fiscal_submission_attempts": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_submission_attempts"].filter((c)=>!["request_checksum","provider_operation_id","provider_correlation_reference","provider_response_reference"].includes(c)), insert: [], update: [] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_submission_attempts"], insert: ["id","tenant_id","company_id","external_integration_id","fiscal_connection_id","electronic_document_id","fiscal_document_preparation_id","preparation_generation","integration_dispatch_id","credential_binding_id","credential_binding_generation","dispatch_class","operation_type","attempt_number","status","request_id","idempotency_key","request_checksum","correlation_id","causation_id","created_at","version"], update: ["status","transport_status","normalized_result","provider_operation_id","provider_correlation_reference","provider_response_reference","http_status","provider_code_raw","retry_classification","error_code","retry_after_at","started_at","completed_at","version"] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_submission_attempts"].filter((c)=>!["request_id","idempotency_key","request_checksum","provider_operation_id","provider_correlation_reference","provider_response_reference"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_submission_attempts"].filter((c)=>!["request_id","idempotency_key","request_checksum","provider_operation_id","provider_correlation_reference","provider_response_reference"].includes(c)), insert: [], update: [] },
  },
  "fiscal.fiscal_artifacts": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"].filter((c)=>!["storage_reference","provider_reference","authority_reference"].includes(c)), insert: [], update: [] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"], insert: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"], update: [] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"].filter((c)=>!["storage_reference","provider_reference","authority_reference"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"].filter((c)=>!["storage_reference","provider_reference","authority_reference"].includes(c)), insert: [], update: [] },
  },
  "fiscal.fiscal_reconciliations": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliations"].filter((c)=>!["scope_snapshot_reference","scope_snapshot_checksum","expected_state_snapshot_reference","observed_state_snapshot_reference","provider_evidence_reference","authority_evidence_reference"].includes(c)), insert: ["id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id","scope_type","electronic_document_id","preparation_generation","scope_snapshot_reference","scope_snapshot_checksum","status","expected_state_snapshot_reference","started_by_actor_id","correlation_id","causation_id","created_at","updated_at","version"], update: ["status","reviewed_by_actor_id","closed_by_actor_id","resolution_reason","closed_at","updated_at","version"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliations"], insert: ["id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id","scope_type","electronic_document_id","preparation_generation","scope_snapshot_reference","scope_snapshot_checksum","status","expected_state_snapshot_reference","started_by_actor_id","correlation_id","causation_id","created_at","updated_at","version"], update: ["status","observed_state_snapshot_reference","provider_evidence_reference","authority_evidence_reference","discrepancy_summary_code","started_at","closed_at","updated_at","version"] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliations"].filter((c)=>!["scope_snapshot_reference","scope_snapshot_checksum","expected_state_snapshot_reference","observed_state_snapshot_reference","provider_evidence_reference","authority_evidence_reference"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliations"].filter((c)=>!["scope_snapshot_reference","scope_snapshot_checksum","expected_state_snapshot_reference","observed_state_snapshot_reference","provider_evidence_reference","authority_evidence_reference"].includes(c)), insert: [], update: [] },
  },
  "fiscal.fiscal_incidents": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_incidents"].filter((c)=>c!=="evidence_reference"), insert: ["id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id","electronic_document_id","preparation_generation","fiscal_submission_attempt_id","fiscal_reconciliation_id","incident_type","severity","status","summary_code","evidence_reference","correlation_id","causation_id","created_at","updated_at","version"], update: ["status","assigned_reviewer_id","resolution_type","resolution_reason","resolved_by_actor_id","resolved_at","archived_at","updated_at","version"] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_incidents"], insert: ["id","tenant_id","company_id","branch_id","external_integration_id","fiscal_connection_id","electronic_document_id","preparation_generation","fiscal_submission_attempt_id","fiscal_reconciliation_id","incident_type","severity","status","summary_code","evidence_reference","correlation_id","causation_id","created_at","updated_at","version"], update: [] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_incidents"].filter((c)=>c!=="evidence_reference"), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_incidents"].filter((c)=>c!=="evidence_reference"), insert: [], update: [] },
  },
  "fiscal.fiscal_reconciliation_items": {
    pos_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"].filter((c)=>!["expected_state_reference","observed_state_reference","evidence_reference"].includes(c)), insert: [], update: [] },
    pos_worker: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"], insert: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"], update: [] },
    pos_platform_app: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"].filter((c)=>!["expected_state_reference","observed_state_reference","evidence_reference"].includes(c)), insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"].filter((c)=>!["expected_state_reference","observed_state_reference","evidence_reference"].includes(c)), insert: [], update: [] },
  },
} as const;

export const FISCAL_003_INTEGRATION_EXTENSION_GRANTS = {
  "integrations.integration_dispatches": {
    pos_app: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"], insert: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"], update: [] },
    pos_worker: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"], insert: [], update: [] },
    pos_platform_app: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"], insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"], insert: [], update: [] },
  },
  "integrations.external_webhook_receipts": {
    pos_app: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"], insert: [], update: [] },
    pos_worker: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"], insert: [], update: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"] },
    pos_platform_app: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"], insert: [], update: [] },
    pos_platform_admin: { select: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"], insert: [], update: [] },
  },
} as const;

export const FISCAL_003_PROHIBITED_CATALOG = {
  electronicDocumentColumns: ["provider_document_id","provider_reference","provider_status_raw"],
  attemptConstraints: ["fiscal_submission_attempts_idempotency_uq"],
  leaseColumns: ["lease_owner","lease_expires_at","lease_acquired_at","lease_token"],
  operationTypes: ["QUERY_DOCUMENT_STATUS","RETRIEVE_ARTIFACT"],
  speculativeIndexes: ["fiscal_emission_configurations_connection_idx","electronic_documents_connection_idx","electronic_documents_legal_number_uq","electronic_documents_provider_document_uq"],
} as const;

export const FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS = [
  "electronic_documents_current_preparation_guard",
  "fiscal_document_preparations_current_generation_guard",
] as const;

export const FISCAL_003_SHARED_VALIDATOR = "validate_current_fiscal_preparation_invariant" as const;

const ALL_FISCAL_CONSTRAINTS = Object.values(FISCAL_003_TABLE_CONSTRAINTS).flat();
const ALL_003_CONSTRAINTS = [...ALL_FISCAL_CONSTRAINTS, ...FISCAL_003_EXTENSION_CONSTRAINTS] as const;

export interface FiscalMigrationDescriptor extends MigrationDescriptor {
  targetPostgresVersion: "16.14";
  alteredTables: readonly string[];
  sqliteArtifact: "NONE";
  fiscalTableCount: 10;
  operationTypes: readonly ["SUBMIT_DOCUMENT"];
  expectedTableColumns: typeof FISCAL_003_TABLE_COLUMNS;
  expectedGuards: typeof FISCAL_003_REQUIRED_GUARDS;
  grantMatrix: typeof FISCAL_003_GRANT_MATRIX;
  integrationExtensionColumns: typeof FISCAL_003_INTEGRATION_EXTENSION_COLUMNS;
  integrationExtensionGrants: typeof FISCAL_003_INTEGRATION_EXTENSION_GRANTS;
  prohibitedCatalog: typeof FISCAL_003_PROHIBITED_CATALOG;
  currentPreparationConstraintTriggers: typeof FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS;
  sharedCurrentPreparationValidator: typeof FISCAL_003_SHARED_VALIDATOR;
  catalogDefinitions: typeof FISCAL_003_CATALOG_DEFINITIONS;
  tableBlueprintSql: typeof FISCAL_003_TABLE_BLUEPRINT_SQL;
  exactConstraintDefinitions: typeof FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS;
  exactIndexDefinitions: typeof FISCAL_003_EXACT_INDEX_DEFINITIONS;
  exactGuardDefinitions: typeof FISCAL_003_EXACT_GUARD_DEFINITIONS;
  exactPolicyDefinitions: typeof FISCAL_003_EXACT_POLICY_DEFINITIONS;
  ownedFunctions: typeof FISCAL_003_REQUIRED_FUNCTIONS;
  exactFunctionDefinitions: typeof FISCAL_003_FUNCTION_DEFINITION_SQL;
  semanticCatalogSha256: string;
  legacyConstraintTransitions: typeof FISCAL_003_DISPATCH_CLASS_TRANSITION;
  legacyGuardTransitions: typeof FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION;
  legacyGrantTransitions: typeof FISCAL_003_LEGACY_GRANT_TRANSITIONS;
  externalFenceContracts: typeof FISCAL_003_EXTERNAL_FENCE_CONTRACTS;
  mat003PrerequisiteOnly: true;
}

export const POSTGRES_003_DESCRIPTOR: FiscalMigrationDescriptor = {
  migrationId: "003_fiscal_electronic_invoicing_foundation",
  manifestVersion: 1,
  dependencies: [
    POSTGRES_001_DESCRIPTOR.migrationId,
    POSTGRES_002_DESCRIPTOR.migrationId,
  ],
  upArtifact: "postgres/003_fiscal_electronic_invoicing_foundation.up.sql",
  downArtifact: "postgres/003_fiscal_electronic_invoicing_foundation.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["fiscal"],
  ownedTables: FISCAL_TABLES.map((name) => `fiscal.${name}`),
  ownedPolicies: FISCAL_003_REQUIRED_POLICIES,
  ownedConstraints: ALL_003_CONSTRAINTS,
  ownedIndexes: FISCAL_003_REQUIRED_INDEXES,
  requiredExtensions: ["btree_gist"],
  expectedLedgerState: "APPLIED",
  targetPostgresVersion: "16.14",
  alteredTables: FISCAL_003_ALTERED_TABLES,
  sqliteArtifact: "NONE",
  fiscalTableCount: 10,
  operationTypes: ["SUBMIT_DOCUMENT"],
  expectedTableColumns: FISCAL_003_TABLE_COLUMNS,
  expectedGuards: FISCAL_003_REQUIRED_GUARDS,
  grantMatrix: FISCAL_003_GRANT_MATRIX,
  integrationExtensionColumns: FISCAL_003_INTEGRATION_EXTENSION_COLUMNS,
  integrationExtensionGrants: FISCAL_003_INTEGRATION_EXTENSION_GRANTS,
  prohibitedCatalog: FISCAL_003_PROHIBITED_CATALOG,
  currentPreparationConstraintTriggers: FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS,
  sharedCurrentPreparationValidator: FISCAL_003_SHARED_VALIDATOR,
  catalogDefinitions: FISCAL_003_CATALOG_DEFINITIONS,
  tableBlueprintSql: FISCAL_003_TABLE_BLUEPRINT_SQL,
  exactConstraintDefinitions: FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS,
  exactIndexDefinitions: FISCAL_003_EXACT_INDEX_DEFINITIONS,
  exactGuardDefinitions: FISCAL_003_EXACT_GUARD_DEFINITIONS,
  exactPolicyDefinitions: FISCAL_003_EXACT_POLICY_DEFINITIONS,
  ownedFunctions: FISCAL_003_REQUIRED_FUNCTIONS,
  exactFunctionDefinitions: FISCAL_003_FUNCTION_DEFINITION_SQL,
  semanticCatalogSha256: "3d479eb5166e274b4d5d528af9ed901920282e0cb7c05db6922c5bcc6f82b86a",
  legacyConstraintTransitions: FISCAL_003_DISPATCH_CLASS_TRANSITION,
  legacyGuardTransitions: FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION,
  legacyGrantTransitions: FISCAL_003_LEGACY_GRANT_TRANSITIONS,
  externalFenceContracts: FISCAL_003_EXTERNAL_FENCE_CONTRACTS,
  mat003PrerequisiteOnly: true,
};
