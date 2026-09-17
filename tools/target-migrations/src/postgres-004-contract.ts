import type { MigrationDescriptor } from "./contract.js";

export const DEVICE_TRUST_004_TABLES = [
  "identity.device_registry",
  "identity.device_credentials",
  "identity.device_enrollment_activations",
  "identity.device_authentication_events",
] as const;

export const DEVICE_TRUST_004_COLUMNS = {
  "identity.device_registry": ["device_id","installation_id","tenant_id","company_id","device_key_id","device_public_key","device_public_key_algorithm","status","trust_key_id","trust_key_purpose","created_at","updated_at","version"],
  "identity.device_credentials": ["credential_id","device_id","installation_id","tenant_id","company_id","device_key_id","trust_key_id","key_purpose","status","generation","issued_at","expires_at","credential_checksum","issuer_signature","created_at","revoked_at","revoked_reason","version"],
  "identity.device_enrollment_activations": ["activation_id","tenant_id","company_id","installation_id","device_id","activation_checksum","status","issued_at","expires_at","consumed_at","consumed_credential_id"],
  "identity.device_authentication_events": ["id","device_id","credential_id","tenant_id","company_id","installation_id","result","reason_code","correlation_id","occurred_at","evidence_checksum"],
} as const;

export const POSTGRES_004_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "004_device_trust",
  manifestVersion: 1,
  dependencies: ["003_fiscal_electronic_invoicing_foundation"],
  upArtifact: "postgres/004_device_trust.up.sql",
  downArtifact: "postgres/004_device_trust.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: [],
  ownedTables: DEVICE_TRUST_004_TABLES,
  ownedPolicies: [],
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
