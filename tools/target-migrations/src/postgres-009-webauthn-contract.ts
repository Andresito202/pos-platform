import type { MigrationDescriptor } from "./contract.js";

/**
 * Additive, isolated D3-R5.2 persistence for challenges. NOT an MFA factor
 * or credential store; identity.mfa_factors remains the canonical factor.
 * A production runner and deployment gate must not apply 009 out of order.
 */
export const WEBAUTHN_009_TABLES = ["identity.webauthn_challenges"] as const;
export const WEBAUTHN_009_COLUMNS = [
  "id", "user_id", "factor_id", "session_id", "purpose", "challenge_hash",
  "rp_id", "expected_origin", "issued_at", "expires_at", "consumed_at",
  "correlation_id", "version",
] as const;

export const POSTGRES_009_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "009_webauthn_challenges",
  manifestVersion: 1,
  dependencies: ["008_platform_role_assignments"],
  upArtifact: "postgres/009_webauthn_challenges.up.sql",
  downArtifact: "postgres/009_webauthn_challenges.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["identity"],
  ownedTables: WEBAUTHN_009_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
