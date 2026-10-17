import type { MigrationDescriptor } from "./contract.js";

export const FACTUS_PAY_009_TABLES = [
  "integrations.factus_pay_webhook_keys",
  "integrations.factus_pay_webhook_inbox",
] as const;

export const POSTGRES_009_DESCRIPTOR: MigrationDescriptor = {
  migrationId: "009_factus_pay_webhook_inbox",
  manifestVersion: 1,
  dependencies: ["008_platform_role_assignments"],
  upArtifact: "postgres/009_factus_pay_webhook_inbox.up.sql",
  downArtifact: "postgres/009_factus_pay_webhook_inbox.down.sql",
  checksum: "DERIVED_FROM_UP_ARTIFACT",
  ownedSchemas: ["integrations"],
  ownedTables: FACTUS_PAY_009_TABLES,
  ownedPolicies: "DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints: "DERIVED_FROM_UP_ARTIFACT",
  ownedIndexes: "DERIVED_FROM_UP_ARTIFACT",
  requiredExtensions: [],
  expectedLedgerState: "APPLIED",
};
