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
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT";
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT";
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT";
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
  "fiscal_submission_attempts",
  "fiscal_artifacts",
  "fiscal_reconciliations",
  "fiscal_incidents",
  "fiscal_reconciliation_items",
] as const;

export const FISCAL_RLS_TABLES = FISCAL_TABLES;

export const POSTGRES_003_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "003_fiscal_electronic_invoicing_foundation",
  manifestVersion: 1,
  dependencies: [POSTGRES_002_DESCRIPTOR.migrationId],
  upArtifact: "postgres/003_fiscal_electronic_invoicing_foundation.up.sql",
  downArtifact: "postgres/003_fiscal_electronic_invoicing_foundation.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["fiscal"],
  ownedTables: FISCAL_TABLES.map((name) => `fiscal.${name}`),
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: ["btree_gist"],
  expectedLedgerState: "APPLIED",
};
